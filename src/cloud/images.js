/*
 * Image offloading.
 *
 * Pasted images are compressed and stored inline as base64 data URLs, which is
 * fine for localStorage but would quickly breach Firestore's 1 MiB document
 * limit. Once signed in, every inline image is moved to Cloud Storage and the
 * block keeps a download URL instead.
 *
 * This runs quietly in the background, a few images at a time, and is safe to
 * call repeatedly - already-uploaded blocks are skipped.
 */
import { store } from "../state.js";
import { getFirebase } from "./firebase.js";

const BATCH = 3;
let running = false;

function walkBlocks(blocks, fn) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    fn(b);
    if (b.type === "toggle") walkBlocks(b.children, fn);
  });
}

/** Every image block still holding a base64 payload, with its page id. */
export function pendingInlineImages() {
  const out = [];
  const pages = store.state.pages || {};
  for (const pageId in pages) {
    walkBlocks(pages[pageId].blocks, (b) => {
      if (b.type === "image" && typeof b.src === "string" && b.src.startsWith("data:")) {
        out.push({ pageId, block: b });
      }
    });
  }
  return out;
}

function extensionFor(dataUrl) {
  const m = /^data:image\/([a-z0-9+.-]+);/i.exec(dataUrl || "");
  const type = (m ? m[1] : "jpeg").toLowerCase();
  if (type === "jpeg" || type === "jpg") return "jpg";
  if (type === "svg+xml") return "svg";
  return type.replace(/[^a-z0-9]/g, "") || "jpg";
}

/**
 * Uploads up to a few inline images for this user.
 * @returns { moved, remaining } so the caller can decide whether to re-run.
 */
export async function runImageMigration(uid, onChanged) {
  if (running || !uid) return { moved: 0, remaining: 0 };
  const fb = await getFirebase();
  if (!fb.ok) return { moved: 0, remaining: 0 };

  const queue = pendingInlineImages();
  if (queue.length === 0) return { moved: 0, remaining: 0 };

  running = true;
  let moved = 0;
  try {
    const slice = queue.slice(0, BATCH);
    for (const item of slice) {
      const block = item.block;
      const dataUrl = block.src;
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) continue;
      const path = "users/" + uid + "/images/" + block.id + "." + extensionFor(dataUrl);
      try {
        const storageRef = fb.sdk.ref(fb.storage, path);
        await fb.sdk.uploadString(storageRef, dataUrl, "data_url");
        const url = await fb.sdk.getDownloadURL(storageRef);
        // Only swap the source once the upload is definitely readable.
        block.src = url;
        block.storagePath = path;
        moved += 1;
        if (typeof onChanged === "function") onChanged(item.pageId);
      } catch (e) {
        console.warn("[images] upload failed for block " + block.id, e);
        // Leave the data URL alone; it still renders and we retry next pass.
      }
    }
  } finally {
    running = false;
  }

  return { moved, remaining: Math.max(0, pendingInlineImages().length) };
}

/** Best-effort tidy-up when a page is deleted for good. */
export async function deleteStoredImages(page) {
  const fb = await getFirebase();
  if (!fb.ok || !page) return;
  const paths = [];
  walkBlocks(page.blocks, (b) => {
    if (b.type === "image" && b.storagePath) paths.push(b.storagePath);
  });
  for (const p of paths) {
    try {
      await fb.sdk.deleteObject(fb.sdk.ref(fb.storage, p));
    } catch (e) {
      /* already gone, or no permission - nothing useful to do */
    }
  }
}

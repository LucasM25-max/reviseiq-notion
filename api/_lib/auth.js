/*
 * Firebase ID token verification, with no dependencies.
 *
 * Vercel functions here run on Node 20+, so Web Crypto is available globally.
 * Google publishes the public keys for Firebase ID tokens as a JWK set, which
 * means we can verify an RS256 signature without pulling in firebase-admin.
 *
 * Files in api/_lib are ignored by Vercel's router (leading underscore), so
 * this is a helper module rather than an endpoint.
 */

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwksCache = null;
let jwksExpiry = 0;

async function getKeys() {
  const now = Date.now();
  if (jwksCache && now < jwksExpiry) return jwksCache;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Could not fetch Google signing keys.");
  const body = await res.json();
  const keys = {};
  (body.keys || []).forEach((k) => {
    if (k.kid) keys[k.kid] = k;
  });
  jwksCache = keys;
  // Respect the cache header when it is there, otherwise re-fetch hourly.
  const cc = res.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  const maxAge = m ? Number(m[1]) : 3600;
  jwksExpiry = now + Math.max(300, Math.min(maxAge, 86400)) * 1000;
  return keys;
}

function b64urlToBytes(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

function b64urlToJson(input) {
  return JSON.parse(Buffer.from(b64urlToBytes(input)).toString("utf8"));
}

/**
 * Verifies a Firebase ID token for the given project.
 * Resolves with the decoded payload, or throws.
 */
export async function verifyIdToken(token, projectId) {
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Malformed token.");
  }
  const [headerPart, payloadPart, signaturePart] = token.split(".");

  let header;
  let payload;
  try {
    header = b64urlToJson(headerPart);
    payload = b64urlToJson(payloadPart);
  } catch (e) {
    throw new Error("Malformed token.");
  }

  if (header.alg !== "RS256") throw new Error("Unexpected token algorithm.");
  if (!header.kid) throw new Error("Token has no key id.");

  const keys = await getKeys();
  const jwk = keys[header.kid];
  if (!jwk) throw new Error("Unknown signing key.");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(signaturePart),
    new TextEncoder().encode(headerPart + "." + payloadPart)
  );
  if (!ok) throw new Error("Bad token signature.");

  const nowSec = Math.floor(Date.now() / 1000);
  const skew = 60; // tolerate a minute of clock drift
  if (typeof payload.exp !== "number" || payload.exp + skew < nowSec) {
    throw new Error("Token has expired.");
  }
  if (typeof payload.iat === "number" && payload.iat - skew > nowSec) {
    throw new Error("Token is not valid yet.");
  }
  if (payload.aud !== projectId) throw new Error("Token is for another project.");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) {
    throw new Error("Token has the wrong issuer.");
  }
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Token has no subject.");

  return payload;
}

function bearerFrom(req) {
  const raw = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Gate for the Gemini endpoints.
 *
 * Behaviour is deliberately forgiving so the app keeps working while Firebase
 * is being set up:
 *   - No FIREBASE_PROJECT_ID set  -> auth is off, everyone is allowed through.
 *   - REQUIRE_AUTH=1              -> a valid Firebase ID token is mandatory.
 *   - Otherwise                   -> a token is verified when present, and an
 *                                    anonymous caller is still allowed.
 *
 * Returns { uid } on success, or null after it has already replied with 401.
 */
export async function requireUser(req, res, send) {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const mustAuth = process.env.REQUIRE_AUTH === "1";
  const token = bearerFrom(req);

  if (!projectId) return { uid: null, verified: false };

  if (!token) {
    if (mustAuth) {
      send(res, 401, { error: "Please sign in to use ReviseIQ AI.", code: "auth-required" });
      return null;
    }
    return { uid: null, verified: false };
  }

  try {
    const payload = await verifyIdToken(token, projectId);
    return { uid: payload.sub, email: payload.email || "", verified: true };
  } catch (e) {
    if (mustAuth) {
      send(res, 401, { error: "Your session has expired. Sign in again.", code: "auth-expired" });
      return null;
    }
    return { uid: null, verified: false };
  }
}

/*
 * GET /api/config
 *
 * The Firebase web config is public by design (it identifies the project, it
 * does not grant access - the security rules do that). The app is a static
 * site with no build step, so rather than baking the values into a JS file we
 * serve them from Vercel environment variables here. That keeps one source of
 * truth and lets you rotate a project without editing code.
 */
function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(payload));
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." });

  const firebase = {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || ""
  };

  const configured = Boolean(firebase.apiKey && firebase.projectId && firebase.appId);

  // Most projects have a single database called "(default)". Projects created
  // by Google AI Studio instead get a named one (ai-studio-...), which the SDK
  // will not find unless we ask for it by name.
  const databaseId = (process.env.FIREBASE_DATABASE_ID || "(default)").trim() || "(default)";

  return send(res, 200, {
    configured,
    requireAuth: process.env.REQUIRE_AUTH === "1",
    databaseId,
    firebase: configured ? firebase : null
  });
}

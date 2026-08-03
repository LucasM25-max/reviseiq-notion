# ReviseIQ - Firebase setup

Everything in the app keeps working with no Firebase at all: notes stay in
`localStorage` exactly as before. Follow this once to turn on accounts, sync
and image offloading. About ten minutes, all of it free tier.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Create a project**.
2. Name it `reviseiq` (any name is fine). Google Analytics is not needed.
3. Wait for it to be created, then open it.

## 2. Register the web app

1. On the project overview, click the **`</>`** (Web) icon.
2. Nickname: `ReviseIQ web`. Do **not** tick Firebase Hosting - the app is on Vercel.
3. Click **Register app**. Firebase shows a `firebaseConfig` object. Keep this
   tab open; you need six values from it:

   ```
   apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId
   ```

   These are safe to expose publicly - they identify the project, they do not
   grant access. Access is controlled by the rules in step 5.

## 3. Turn on sign-in methods

1. **Build > Authentication > Get started**.
2. On **Sign-in method**, enable:
   - **Google** - choose a support email, Save.
   - **Email/Password** - and inside it also switch on **Email link
     (passwordless sign-in)**, Save.
3. **Settings > Authorized domains > Add domain**: add `your-project.vercel.app`
   and any custom domain. `localhost` is already listed.

## 4. Create the database and the bucket

1. **Build > Firestore Database > Create database** - production mode,
   location `eur3 (europe-west)` for the UK.
2. **Build > Storage > Get started** - same location, production mode.

## 5. Paste in the security rules

Both files are in the repo root.

1. **Firestore Database > Rules**: replace everything with `firestore.rules`, **Publish**.
2. **Storage > Rules**: replace everything with `storage.rules`, **Publish**.

Both say the same thing: a signed-in student can touch only their own
`users/{uid}` data, and nobody else's.

## 6. Add the environment variables in Vercel

Vercel dashboard > project > **Settings > Environment Variables**. Add these to
**Production, Preview and Development**:

| Name | Value (from step 2) |
| --- | --- |
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain`, e.g. `reviseiq.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket`, e.g. `reviseiq.appspot.com` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |

`GEMINI_API_KEY` stays exactly as it is.

Optional, once you have signed in successfully at least once:

| Name | Value | Effect |
| --- | --- | --- |
| `REQUIRE_AUTH` | `1` | The quiz and mock exam endpoints reject callers without a valid Firebase token, so nobody can burn your Gemini quota. Leave it unset while testing. |

Redeploy afterwards (Deployments > latest > **Redeploy**).

## 7. Allow uploads from your domain (CORS)

Only needed if you paste images into notes.

1. Open <https://console.cloud.google.com>, pick the same project, click the
   **Cloud Shell** icon (top right).
2. Run, replacing the domain and bucket name:

   ```bash
   cat > cors.json <<'JSON'
   [
     {
       "origin": ["https://your-project.vercel.app", "http://localhost:3000"],
       "method": ["GET", "PUT", "POST", "HEAD"],
       "responseHeader": ["Content-Type", "Authorization", "Content-Length", "User-Agent", "x-goog-resumable"],
       "maxAgeSeconds": 3600
     }
   ]
   JSON
   gcloud storage buckets update gs://YOUR_BUCKET --cors-file=cors.json
   ```

   `YOUR_BUCKET` is the `storageBucket` value.

## 8. Check it works

1. Open the deployed site. A **Sign in to sync** row appears at the bottom of
   the sidebar. If it does not, visit `/api/config` and confirm
   `"configured": true`.
2. Sign in with Google. The row becomes your name with **Synced** underneath.
3. In Firebase console > Firestore you should see `users / <uid> / pages / ...`.
4. Open the site on your phone, sign in with the same account, and your notes
   arrive. Type on one device and watch it appear on the other in a few seconds.

## First sign-in on a device that already has notes

ReviseIQ asks once:

- **Merge them** - keep everything, newer version wins per page. Recommended.
- **Keep this device** - the account is replaced by this device's notes.
- **Keep the account** - this device is replaced by the account's notes.

A JSON backup downloads automatically before anything is replaced.

## Costs

One student sits far inside the free Spark plan: 1 GiB stored, 50k reads and
20k writes a day, 5 GB of Storage. Writes are batched and debounced, so a heavy
revision session is a few hundred writes, not thousands.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sidebar row never appears | `/api/config` returns `configured: false`. Check the six variables and redeploy. |
| `auth/unauthorized-domain` | Add the domain under Authentication > Settings > Authorized domains. |
| Sign-in popup closes instantly | Popup blocker. The app falls back to a redirect automatically. |
| Status stuck on "Sync paused" | The rules were probably not published. Re-paste `firestore.rules` and publish. |
| Images stay as data URLs | CORS (step 7) is not set on the bucket. |
| "Please sign in to use ReviseIQ AI" | `REQUIRE_AUTH=1` is set and you are signed out. |

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
| `FIREBASE_DATABASE_ID` | Optional. Only needed if your Firestore database is not called `(default)` - see below. |

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

## Named databases (Google AI Studio projects)

Almost every Firebase project has one Firestore database called `(default)`, and
the SDK assumes that name. Projects that Google AI Studio creates are the
exception: they arrive with a database named something like
`ai-studio-51ee6c86-77b7-4d29-965f-172cbb5d1cc8`. The database is perfectly
fine, the name is just different - but the app looks for `(default)`, finds
nothing there, and reports "No Firestore database in this project".

To find your database name, open **Build -> Firestore Database** and read the
dropdown at the top of the page, next to the word *Database*.

If it says anything other than `(default)`, add one more Vercel environment
variable and redeploy:

```
FIREBASE_DATABASE_ID = ai-studio-51ee6c86-77b7-4d29-965f-172cbb5d1cc8
```

Copy the name exactly: no quotes, no trailing spaces.

Two things to remember with a named database:

- **Rules are per database.** On the **Rules** tab, use the database dropdown to
  select the named database before pasting `firestore.rules` and publishing.
  Rules published to `(default)` do not apply to it.
- **Indexes are per database too**, so if Firestore asks for an index, follow the
  link it prints rather than creating one by hand.

The alternative is to create a second database actually called `(default)` and
leave `FIREBASE_DATABASE_ID` unset. Both work; reusing the existing one is fewer
moving parts.

## If sync will not connect

Open the site, press F12 (or long-press > Inspect on mobile) and use the console:

```js
reviseiqSync.status()       // what the sidebar is showing, and why
reviseiqSync.diagnose()     // asks Firestore over plain HTTPS what is wrong
reviseiqSync.state()        // uid, pages tracked, whether it has ever synced
reviseiqSync.longPolling()  // true if it fell back to the slow transport
reviseiqSync.flush()        // force a push right now
```

`diagnose()` bypasses the streaming SDK entirely, so it can tell the difference
between the four things that all look identical from inside the app:

| `reason` | What it means | Fix |
| --- | --- | --- |
| `ok` | Firestore is fine; the network is interfering with the streaming connection | Nothing - the app switches itself to long polling |
| `no-database` | The project has no Firestore database | Build > Firestore Database > Create database, Native mode, `eur3` |
| `api-disabled` | The Cloud Firestore API is switched off for the project | Enable **Cloud Firestore API** in the Google Cloud console, then reload |
| `datastore-mode` | The database exists but is a Datastore-mode one | Create a Firestore **Native mode** database instead |
| `rules` | The backend is reachable but the rules reject you | Publish `firestore.rules` |
| `network-blocked` | The network is blocking `firestore.googleapis.com` outright | Try mobile data or a different wifi |

Projects created automatically by Google AI Studio (names like
`gen-lang-client-...`) usually have **no Firestore database at all** until you
create one, which is by far the most common cause of a stubborn
"Can't reach Firestore".

### The long-polling fallback

Firestore normally uses a streaming connection that school wifi, filtered
networks and some proxies quietly block. When that happens ReviseIQ notices,
reconnects using ordinary long polling, retries the push, and remembers the
choice on that device so later visits connect straight away. To reset it after
moving to a normal network, clear the `reviseiq_force_long_polling` key in
Application > Local Storage and reload.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sidebar row never appears | `/api/config` returns `configured: false`. Check the six variables and redeploy. |
| `auth/unauthorized-domain` | Add the domain under Authentication > Settings > Authorized domains. |
| Sign-in popup closes instantly | Popup blocker. The app falls back to a redirect automatically. |
| Status stuck on "Sync paused" | The rules were probably not published. Re-paste `firestore.rules` and publish. |
| Images stay as data URLs | CORS (step 7) is not set on the bucket. |
| "Please sign in to use ReviseIQ AI" | `REQUIRE_AUTH=1` is set and you are signed out. |

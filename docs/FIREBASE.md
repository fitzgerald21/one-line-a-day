# Moving to Firebase

The app already talks to storage through an **adapter** (`js/storage/`). Today it uses the browser's
`localStorage`; once you paste a Firebase config it switches to **Firebase Auth + Cloud Firestore** with no
other code changes. The UI, book, journal and editor are untouched — they read from an in-memory cache
(`js/store.js`) that the adapter keeps in sync.

## This app's project (shared)

One Line a Day uses the **`come-back-fitz21`** Firebase project, shared with Come back and Little Bites. It has its
own web app registration ("One Line a Day"); the config is already in `js/storage/config.js`. Google sign-in and the
`fitzgerald21.github.io` authorized domain are already set up there.

**Firestore has one ruleset per project, shared by every app in it.** `firestore.rules` (and `storage.rules`) are kept
**identical** in the One Line a Day, Come back and Little Bites repos, so deploying from any of them is safe. If you
edit one, copy it to the other two. This app's data lives under `users/{uid}/entries` and `users/{uid}/settings`;
the other apps use `users/{uid}`, `users/{uid}/sessions` and `users/{uid}/babies`, so the paths don't overlap.
**Only fitzgeraldryan21@gmail.com can use this app's data** (`isOlad` in `firestore.rules`), and the app requires
Google sign-in before opening. To add someone, edit the email in the rules (in all three repos) and `allowedEmail`
in `js/storage/config.js`, then redeploy.
Deploy with: `firebase deploy --only firestore:rules,storage --project come-back-fitz21`

## Setting up a fresh project instead

Skip this if you're using the shared project above.

1. **Create a project** at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method →** enable **Google**.
   Under *Settings → Authorized domains* add the site you host on (e.g. `fitzgerald21.github.io`).
3. **Firestore Database → Create database** (production mode, any region).
4. **Project settings → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` object.
5. Paste it into [`js/storage/config.js`](../js/storage/config.js):
   ```js
   export const firebaseConfig = { apiKey: '…', authDomain: '…', projectId: '…', appId: '…' };
   ```
   (The config is not secret; the security rules below are what protect your data.)
6. **Publish the security rules** — either paste [`firestore.rules`](../firestore.rules) into
   *Firestore → Rules*, or `firebase deploy --only firestore:rules`.
7. Reload the app. It shows **Continue with Google**; after sign-in it automatically uploads any entries that only
   exist in that browser (once per account).

Optional: host it on Firebase too — `firebase deploy --only hosting` (see `firebase.json`), then add the
`*.web.app` domain to the authorized domains. GitHub Pages keeps working either way.

## Data model

```
users/{uid}/entries/{YYYY-MM-DD}     one document per day
    text        string   what's written on the page          (required, ≤ 20,000 chars)
    original    string   the text before "Summarize" (optional, powers the Original button)
    updatedAt   number   ms since epoch — last write wins per day
    year, month, day     numbers, for queries ("on this day" = month == m && day == d)

users/{uid}/settings/app             synced preferences (handwriting, year layout, voice/AI choices…)
```

Why a document per day: it's the unit people edit, so two devices editing different days never conflict;
every write is tiny; the document id is the date, so lookups and "on this day" are trivial; and a five-year
book is at most ~1,830 small documents.

**Never leaves the device:** API keys (Groq / OpenRouter / DeepInfra) and per-device options (one-page vs
two-page, writing size, start-with-cover). They are stored in `localStorage` under `olad.device.v1`.
If you ever want keys to roam, put them in a separate `users/{uid}/secrets` doc with stricter rules and
ideally encrypt them client-side — but don't put them in `settings/app`.

## How sync behaves

- **Offline:** Firestore's persistent cache lets you read and write offline; edits queue and upload on
  reconnect. The top bar shows *Synced / Saving… / Offline · will sync*.
- **Live updates:** an entry changed on another device appears on this one automatically (unless you're
  typing in that very entry — your unsent edit wins until it's saved).
- **Backups still work:** *Settings → Download backup* exports the same JSON in either mode, and *Restore*
  merges it into your account.

## Writing another backend

Implement the contract documented at the top of [`js/storage/local.js`](../js/storage/local.js)
(`load`, `saveEntries`, `saveSettings`, `clearAll`, `subscribe`, `user`) and return it from
`js/storage/boot.js` — e.g. Supabase, a REST API, or a GitHub-gist adapter.

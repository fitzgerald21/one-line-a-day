// Storage adapter: Firebase Auth (Google sign-in) + Cloud Firestore.
//
// Data model — one small document per day, everything under the signed-in user:
//   users/{uid}/entries/{YYYY-MM-DD}   { text, original?, updatedAt (ms), year, month, day }
//   users/{uid}/settings/app           synced preferences (never API keys or per-device options)
//
// Firestore's persistent cache gives offline use + background sync; snapshot listeners give live updates
// across devices. Conflicts are last-write-wins per day (the unit people edit), so two devices editing
// different days never clash.
const V = '11.0.2';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

const toDoc = (k, e) => {
  const [year, month, day] = k.split('-').map(Number);
  return { text: e.t, ...(e.r ? { original: e.r } : {}), updatedAt: e.u || Date.now(), year, month, day };
};
const fromDoc = (d) => ({ t: d.text || '', ...(d.original ? { r: d.original } : {}), u: d.updatedAt || 0 });

export function createFirebaseAdapter(config) {
  let sdk;           // { app, auth, fs } once loaded
  let uid = null;
  let currentUser = null;
  let unsubs = [];

  const ready = (async () => {
    const [appM, authM, fsM] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    const app = appM.initializeApp(config);
    const auth = authM.getAuth(app);
    let db;
    try {
      db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
    } catch {
      db = fsM.getFirestore(app); // already initialised (e.g. hot reload)
    }
    sdk = { appM, authM, fsM, auth, db };
  })();

  const entriesCol = () => sdk.fsM.collection(sdk.db, 'users', uid, 'entries');
  const settingsRef = () => sdk.fsM.doc(sdk.db, 'users', uid, 'settings', 'app');

  const auth = {
    /** Resolves with the signed-in user (restoring a previous session) or null. */
    async ready() {
      await ready;
      await sdk.auth.authStateReady?.();
      currentUser = sdk.auth.currentUser;
      uid = currentUser?.uid || null;
      return currentUser;
    },
    async signIn() {
      await ready;
      const provider = new sdk.authM.GoogleAuthProvider();
      try {
        const res = await sdk.authM.signInWithPopup(sdk.auth, provider);
        currentUser = res.user;
      } catch (err) {
        // Popups are blocked in some in-app browsers / standalone iOS: fall back to a redirect.
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
          await sdk.authM.signInWithRedirect(sdk.auth, provider);
          return null;
        }
        throw err;
      }
      uid = currentUser.uid;
      return currentUser;
    },
    async signOut() {
      await ready;
      unsubs.forEach((u) => u());
      unsubs = [];
      await sdk.authM.signOut(sdk.auth);
      currentUser = null;
      uid = null;
    },
  };

  return {
    name: 'firebase',
    auth,
    user: () => (currentUser ? { id: currentUser.uid, email: currentUser.email, name: currentUser.displayName } : null),
    signOut: async () => { await auth.signOut(); location.reload(); },

    async load() {
      await ready;
      if (!uid) throw new Error('Not signed in');
      const { getDocs, getDoc } = sdk.fsM;
      const [snap, set] = await Promise.all([getDocs(entriesCol()), getDoc(settingsRef())]);
      const entries = {};
      snap.forEach((d) => { if (d.data().text) entries[d.id] = fromDoc(d.data()); });
      return { entries, settings: set.exists() ? set.data() : {} };
    },

    // Writes are queued by the SDK (and survive going offline), so callers don't need to await them for the UI.
    async saveEntries(changes) {
      const { writeBatch, doc, collection } = sdk.fsM;
      const items = Object.entries(changes);
      for (let i = 0; i < items.length; i += 400) { // batches are limited to 500 operations
        const batch = writeBatch(sdk.db);
        for (const [k, e] of items.slice(i, i + 400)) {
          const ref = doc(collection(sdk.db, 'users', uid, 'entries'), k);
          if (e) batch.set(ref, toDoc(k, e)); else batch.delete(ref);
        }
        await batch.commit();
      }
    },

    async saveSettings(synced) {
      await sdk.fsM.setDoc(settingsRef(), synced, { merge: true });
    },

    async clearAll() {
      const snap = await sdk.fsM.getDocs(entriesCol());
      const ids = snap.docs.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 400) {
        const batch = sdk.fsM.writeBatch(sdk.db);
        ids.slice(i, i + 400).forEach((id) => batch.delete(sdk.fsM.doc(entriesCol(), id)));
        await batch.commit();
      }
    },

    subscribe(cb) {
      const { onSnapshot } = sdk.fsM;
      const u1 = onSnapshot(entriesCol(), (snap) => {
        const entries = {};
        for (const ch of snap.docChanges()) {
          if (ch.doc.metadata.hasPendingWrites) continue; // our own write echoing back
          entries[ch.doc.id] = ch.type === 'removed' || !ch.doc.data().text ? null : fromDoc(ch.doc.data());
        }
        if (Object.keys(entries).length) cb({ entries });
      });
      const u2 = onSnapshot(settingsRef(), (snap) => {
        if (snap.exists() && !snap.metadata.hasPendingWrites) cb({ settings: snap.data() });
      });
      unsubs.push(u1, u2);
      return () => { u1(); u2(); };
    },
  };
}

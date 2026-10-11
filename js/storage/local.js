// Storage adapter: this browser's localStorage. The default, and what the app uses until Firebase is configured.
//
// Adapter contract (the Firebase adapter implements the same shape):
//   name                         'local' | 'firebase'
//   async load()                 -> { entries: {YYYY-MM-DD: {t, r?, u}}, settings: {...synced settings} }
//   async saveEntries(changes)   changes: {YYYY-MM-DD: entry | null}  (null = delete)
//   async saveSettings(synced)   the synced (non-device, non-secret) settings
//   async clearAll()             remove every entry
//   subscribe(cb) -> unsubscribe cb({ entries?: {key: entry|null}, replaceAll?: bool, settings? })
//   user()                       signed-in user info or null     signOut()  optional
export const EK = 'olad.entries.v1';
export const SK = 'olad.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function createLocalAdapter() {
  let entries = {};
  let settings = {};
  return {
    name: 'local',
    user: () => null,
    async load() {
      entries = read(EK, {});
      settings = read(SK, {});
      return { entries, settings };
    },
    async saveEntries(changes) {
      for (const [k, e] of Object.entries(changes)) {
        if (e) entries[k] = e; else delete entries[k];
      }
      localStorage.setItem(EK, JSON.stringify(entries)); // throws on quota → store reports it
    },
    async saveSettings(synced) {
      settings = synced;
      localStorage.setItem(SK, JSON.stringify(settings));
    },
    async clearAll() {
      entries = {};
      localStorage.removeItem(EK);
    },
    // Another tab (or the photo-import page) changed the data.
    subscribe(cb) {
      const onStorage = (e) => {
        if (e.key !== EK && e.key !== SK) return;
        entries = read(EK, {});
        settings = read(SK, {});
        cb({ replaceAll: true, entries, settings });
      };
      addEventListener('storage', onStorage);
      return () => removeEventListener('storage', onStorage);
    },
  };
}

// Picks the storage backend (Firebase if configured, otherwise this browser), handles sign-in,
// and initialises the store before the UI is built.
import { h, confirmDialog, toast } from '../ui.js';
import * as store from '../store.js';
import { firebaseConfig } from './config.js';
import { createLocalAdapter, EK } from './local.js';

function showSignIn(adapter) {
  return new Promise((resolve) => {
    const msg = h('p.signin-msg');
    const btn = h('button.btn.primary', { type: 'button', onclick: async () => {
      btn.disabled = true;
      msg.textContent = '';
      try {
        const user = await adapter.auth.signIn();
        if (user) { screen.remove(); resolve(user); } else btn.disabled = false;
      } catch (err) {
        btn.disabled = false;
        msg.textContent = err.code === 'auth/popup-closed-by-user' ? '' : `Couldn’t sign in: ${err.message}`;
      }
    } }, 'Continue with Google');
    const screen = h('div.signin', h('div.signin-card',
      h('div.signin-mark', 'One Line a Day'),
      h('p', 'Sign in to open your book. Your entries sync across your devices.'),
      btn, msg));
    document.body.append(screen);
  });
}

/** Offer to move entries that only exist in this browser into the signed-in account (once per account). */
async function offerMigration(user) {
  const flag = `olad.migrated.${user.id}`;
  if (localStorage.getItem(flag)) return;
  let local = {};
  try { local = JSON.parse(localStorage.getItem(EK)) || {}; } catch { /* nothing usable */ }
  const missing = Object.keys(local).filter((k) => local[k]?.t && !store.hasEntry(k));
  if (missing.length) {
    const yes = await confirmDialog(`This browser has ${missing.length} ${missing.length === 1 ? 'entry' : 'entries'} that aren’t in your account yet. Add them?`,
      { ok: 'Add them', cancel: 'Not now', title: 'Bring your entries along' });
    if (yes) {
      const r = store.importData({ entries: local }, 'merge');
      toast(`Added ${r.added} to your account.`);
    }
  }
  localStorage.setItem(flag, '1');
}

export async function bootStore() {
  if (!firebaseConfig) {
    await store.init(createLocalAdapter());
    return;
  }
  const { createFirebaseAdapter } = await import('./firebase.js');
  const adapter = createFirebaseAdapter(firebaseConfig);
  let user = await adapter.auth.ready();
  if (!user) user = await showSignIn(adapter);
  await store.init(adapter);
  await offerMigration(adapter.user());
}

import { h, icon, toast } from './ui.js';
import * as store from './store.js';
import { createBook } from './book.js';
import { createJournal, createCalendar, createProgress } from './views.js';
import { openEditor } from './editor.js';
import { openSettings } from './settings.js';
import { bootStore } from './storage/boot.js';

await bootStore();

const TABS = [
  ['book', 'Book', 'book'],
  ['journal', 'Journal', 'list'],
  ['calendar', 'Calendar', 'calendar'],
  ['progress', 'Progress', 'chart'],
];

const root = document.getElementById('app');
const book = createBook({ openSettings });

function openInBook(key) {
  show('book');
  book.goToKey(key);
}
const edit = (key) => openEditor(key, { onOpenBook: openInBook, openSettings });

const views = {
  book,
  journal: createJournal({ openEditor: edit }),
  calendar: createCalendar({ openEditor: edit, openInBook }),
  progress: createProgress({ openEditor: edit, openInBook }),
};

const tabButtons = {};
const nav = h('nav.tabs', { 'aria-label': 'Views' }, TABS.map(([id, label, ic]) => {
  const b = h('button.tab', { type: 'button', 'data-view': id, onclick: () => show(id) }, icon(ic, 22), h('span', label));
  tabButtons[id] = b;
  return b;
}));

// cloud sync indicator (only shown when a cloud backend is active)
const syncEl = h('span.sync', { hidden: store.getBackend().name === 'local' });
function paintSync() {
  const st = store.getStatus();
  const offline = !navigator.onLine;
  syncEl.dataset.state = st === 'error' ? 'error' : st === 'saving' || offline ? 'saving' : 'saved';
  syncEl.textContent = st === 'error' ? 'Not saved' : offline ? 'Offline · will sync' : st === 'saving' ? 'Saving…' : 'Synced';
}
store.onStatus(paintSync);
addEventListener('online', paintSync);
addEventListener('offline', paintSync);
paintSync();

const header = h('header.topbar',
  h('div.brand', h('span.brand-mark', icon('book', 18)), h('span.brand-name', 'One Line a Day')),
  nav,
  h('div.top-actions',
    syncEl,
    h('button.icon-btn', { type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => openSettings() }, icon('sliders', 22))));

const main = h('main.views');
const sections = {};
for (const [id] of TABS) {
  const sec = h('section.view#view-' + id, { hidden: true });
  sec.append(views[id].el);
  sections[id] = sec;
  main.append(sec);
}
root.append(header, main);

let current = null;
function show(id) {
  if (!views[id]) id = 'book';
  current = id;
  for (const [vid] of TABS) {
    sections[vid].hidden = vid !== id;
    tabButtons[vid].classList.toggle('on', vid === id);
    tabButtons[vid].setAttribute('aria-current', vid === id ? 'page' : 'false');
  }
  document.body.dataset.view = id;
  views[id].refresh?.();
  try { sessionStorage.setItem('olad.view', id); } catch { /* ignore */ }
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
}
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (views[id] && id !== current) show(id); });

// handwriting style
function applySettings() {
  document.documentElement.dataset.hand = store.getSettings().hand;
}
applySettings();
store.onSettings(applySettings);

// refresh the visible list-style view when data changes
let refreshTimer;
store.onChange(() => {
  if (current === 'book') return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => views[current]?.refresh?.(), 150);
});

store.onStoreError(() => toast(store.getBackend().name === 'local'
  ? 'Couldn’t save — this browser’s storage is full or blocked. Download a backup from Settings.'
  : 'Couldn’t save to your account. Check your connection — your latest edits will retry.', { ms: 8000 }));

// keyboard: arrows turn pages, T jumps to today
addEventListener('keydown', (e) => {
  if (current !== 'book' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  if (book.handleKey(e)) e.preventDefault();
});

// ask the browser not to evict our data (best effort)
let askedPersist = false;
store.onChange(() => {
  if (askedPersist) return;
  askedPersist = true;
  navigator.storage?.persist?.().catch(() => {});
});

const start = location.hash.slice(1) || sessionStorage.getItem('olad.view') || 'book';
show(start);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Settings sheet: look & feel, voice, AI summaries, backup.
import { h, icon, toast, confirmDialog, downloadFile } from './ui.js';
import * as store from './store.js';
import { PROVIDERS, WHISPER_MODELS, testGroqKey, testChatKey } from './ai.js';
import { createModelPicker } from './modelpicker.js';
import { today } from './dates.js';

const HANDS = [
  ['caveat', 'Caveat — loose, quick'],
  ['kalam', 'Kalam — neat marker'],
  ['patrick', 'Patrick Hand — block print'],
  ['clean', 'Clean — typed'],
];

function segmented(options, getValue, onPick) {
  const wrap = h('div.seg', { role: 'radiogroup' });
  const paint = () => {
    wrap.replaceChildren(...options.map(([v, label]) => h('button' + (v === getValue() ? '.on' : ''), {
      type: 'button', role: 'radio', 'aria-checked': v === getValue(), onclick: () => { onPick(v); paint(); },
    }, label)));
  };
  paint();
  return wrap;
}

function keyField({ label, get, set, test, helpUrl, placeholder }) {
  const input = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder, value: get() });
  const eye = h('button.icon-btn', { type: 'button', 'aria-label': 'Show or hide key', onclick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; eye.replaceChildren(icon(show ? 'eyeoff' : 'eye', 18)); } }, icon('eye', 18));
  const status = h('span.key-status');
  input.addEventListener('change', () => { set(input.value.trim()); status.textContent = ''; });
  const testBtn = h('button.btn.small', {
    type: 'button',
    onclick: async () => {
      const k = input.value.trim();
      set(k);
      if (!k) { status.textContent = 'Paste a key first'; status.className = 'key-status bad'; return; }
      status.textContent = 'Checking…'; status.className = 'key-status';
      try { await test(k); status.textContent = '✓ Works'; status.className = 'key-status ok'; }
      catch (err) { status.textContent = `✗ ${err.message}`; status.className = 'key-status bad'; }
    },
  }, 'Test');
  return h('div.field',
    h('label', label, helpUrl && h('a.link', { href: helpUrl, target: '_blank', rel: 'noopener' }, ' get a key ↗')),
    h('div.key-row', input, eye, testBtn), status);
}

export function openSettings(section) {
  const s = () => store.getSettings();
  const cloud = store.getBackend();
  const dlg = h('dialog.sheet.settings');
  let provider = s().ai.provider;

  const picker = createModelPicker({
    provider: () => provider,
    selected: () => (s().ai.provider === provider ? s().ai.model : ''),
    onSelect: (m) => store.updateSettings({ ai: { provider, model: m.id } }),
  });

  const charsOut = h('output', s().ai.summaryChars);
  const years = store.entryYears();
  const cy = today().y;
  const startYears = [];
  for (let y = Math.min(years[0] ?? cy, cy); y <= cy; y++) startYears.push(y);

  const providerSeg = segmented(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label]), () => provider, (v) => {
    provider = v;
    store.updateSettings({ ai: { provider: v, model: s().ai.provider === v ? s().ai.model : '' } });
    picker.providerChanged();
  });

  const sections = {};
  const sec = (id, title, ...kids) => (sections[id] = h('section.set-sec', { id: `set-${id}` }, h('h3', title), ...kids));

  const body = h('div.sheet-body',
    sec('look', 'The book',
      h('div.field', h('label', 'Years shown on each page'),
        segmented([['sofar', 'Years so far'], ['five', 'All five rows']], () => s().layout, (v) => store.updateSettings({ layout: v })),
        h('p.hint', '“Years so far” only shows rows from the first year you wrote to this year. Rows grow as you go.')),
      h('div.field', h('label', 'First year of the book'),
        h('select', { onchange: (e) => store.updateSettings({ startYear: e.target.value === 'auto' ? 'auto' : +e.target.value }) },
          h('option', { value: 'auto', selected: s().startYear === 'auto' }, 'Automatic (earliest year with entries)'),
          startYears.map((y) => h('option', { value: y, selected: s().startYear === y }, y)))),
      h('div.field', h('label', 'Pages on screen'),
        segmented([['auto', 'Automatic'], ['single', 'One page'], ['spread', 'Two pages']], () => s().pages, (v) => store.updateSettings({ pages: v }))),
      h('div.field', h('label', 'Writing size'),
        segmented([['book', 'Like the book'], ['comfy', 'Comfortable'], ['large', 'Large']], () => s().writing, (v) => store.updateSettings({ writing: v })),
        h('p.hint', 'Bigger writing means fewer ruled lines per year — handy on a phone.')),
      h('div.field', h('label', 'Handwriting'),
        h('select', { onchange: (e) => store.updateSettings({ hand: e.target.value }) }, HANDS.map(([v, l]) => h('option', { value: v, selected: s().hand === v }, l)))),
      h('label.check', h('input', { type: 'checkbox', checked: !s().skipCover, onchange: (e) => store.updateSettings({ skipCover: !e.target.checked }) }), ' Start with the book closed (tap the cover to open)')),

    sec('voice', 'Voice dictation · Groq Whisper',
      keyField({ label: 'Groq API key', placeholder: 'gsk_…', helpUrl: 'https://console.groq.com/keys', get: () => s().keys.groq, set: (v) => store.updateSettings({ keys: { groq: v } }), test: testGroqKey }),
      h('div.field', h('label', 'Whisper model'),
        h('select', { onchange: (e) => store.updateSettings({ whisper: { model: e.target.value } }) }, WHISPER_MODELS.map(([v, l]) => h('option', { value: v, selected: s().whisper.model === v }, l)))),
      h('div.field', h('label', 'Spoken language (optional)'),
        h('input', { type: 'text', maxlength: 5, placeholder: 'auto-detect — or e.g. en, es, fr', value: s().whisper.language, onchange: (e) => store.updateSettings({ whisper: { language: e.target.value.trim().toLowerCase() } }) }))),

    sec('ai', 'AI summaries',
      h('p.hint', 'Ramble freely, then tap ✨ Summarize to boil it down to a line. Pick OpenRouter or DeepInfra — the live model list and prices load automatically.'),
      h('div.field', h('label', 'Provider'), providerSeg),
      keyField({ label: 'OpenRouter API key', placeholder: 'sk-or-…', helpUrl: PROVIDERS.openrouter.keyUrl, get: () => s().keys.openrouter, set: (v) => store.updateSettings({ keys: { openrouter: v } }), test: (k) => testChatKey('openrouter', k) }),
      keyField({ label: 'DeepInfra API key', placeholder: 'DeepInfra token', helpUrl: PROVIDERS.deepinfra.keyUrl, get: () => s().keys.deepinfra, set: (v) => store.updateSettings({ keys: { deepinfra: v } }), test: (k) => testChatKey('deepinfra', k) }),
      h('div.field', h('label', 'Model'), picker.el),
      h('div.field', h('label', 'Aim for about this many characters'),
        h('div.range-row',
          h('input', { type: 'range', min: 80, max: 600, step: 10, value: s().ai.summaryChars, oninput: (e) => { charsOut.textContent = e.target.value; store.updateSettings({ ai: { summaryChars: +e.target.value } }); } }),
          charsOut)),
      h('div.field', h('label', 'Extra instructions (optional)'),
        h('textarea', { rows: 2, placeholder: 'e.g. “Keep it playful.” or “Always mention who I was with.”', onchange: (e) => store.updateSettings({ ai: { extra: e.target.value } }) }, s().ai.extra)),
      h('label.check', h('input', { type: 'checkbox', checked: s().autoSummarize, onchange: (e) => store.updateSettings({ autoSummarize: e.target.checked }) }), ' Summarize automatically after dictating')),

    sec('data', 'Your data',
      cloud.name === 'local'
        ? h('p.hint', `Entries are stored only in this browser (${store.entryCount().toLocaleString()} so far). API keys never leave your device except to call the services above.`)
        : h('div.account',
          h('p.hint', `Synced to your account${cloud.user?.email ? ` (${cloud.user.email})` : ''} · ${store.entryCount().toLocaleString()} entries. API keys and per-device options stay on this device only.`),
          h('button.btn.small', { type: 'button', onclick: () => cloud.signOut?.() }, 'Sign out')),
      h('div.row.wrap',
        h('button.btn', { type: 'button', onclick: () => { downloadFile(`one-line-a-day-${today().key}.json`, store.exportData()); store.markBackup(); toast('Backup downloaded.'); } }, icon('download', 18), 'Download backup'),
        h('label.btn', icon('upload', 18), 'Restore backup', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: onRestore })),
        h('a.btn', { href: 'import.html' }, icon('camera', 18), 'Import from photos')),
      h('div.row.wrap',
        h('button.btn.danger-outline', { type: 'button', onclick: async () => {
          if (await confirmDialog((cloud.name === 'local' ? 'This permanently deletes every entry stored in this browser.' : 'This permanently deletes every entry in your account, on all your devices.') + ' Download a backup first if you might want them back.', { ok: 'Delete everything', danger: true, title: 'Delete all entries?' })) {
            store.clearEntries(); toast('All entries deleted.');
          }
        } }, icon('trash', 18), 'Delete all entries')),
      h('p.hint', 'Tip: on iPhone, tap Share → “Add to Home Screen” so the app opens full screen and your browser keeps its data.')));

  async function onRestore(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const replace = await confirmDialog(`Found ${Object.keys(data.entries || {}).length} entries. Merge them with what's here (keeping your current text when both exist), or replace everything?`, { ok: 'Merge', cancel: 'Replace all', title: 'Restore backup' });
      const r = store.importData(data, replace ? 'merge' : 'replace');
      toast(`Restored: ${r.added} added${r.skipped ? `, ${r.skipped} kept as-is` : ''}.`);
    } catch (err) {
      toast(`Could not restore: ${err.message}`, { ms: 6000 });
    }
  }

  const jump = (id) => sections[id]?.scrollIntoView({ block: 'start' });
  dlg.append(
    h('div.sheet-head', h('h2', 'Settings'),
      h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close settings', onclick: () => dlg.close() }, icon('x'))),
    h('nav.set-tabs',
      [['look', 'Book'], ['voice', 'Voice'], ['ai', 'AI'], ['data', 'Data']].map(([id, l]) => h('button.chip', { type: 'button', onclick: () => jump(id) }, l))),
    body);
  dlg.addEventListener('close', () => { store.flush(); dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
  if (section) setTimeout(() => jump(section === 'voice' ? 'voice' : section === 'ai' ? 'ai' : 'look'), 30);
}

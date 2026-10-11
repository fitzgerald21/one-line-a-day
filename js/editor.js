// Quick editor sheet for any date (used from Journal, Calendar and Progress).
import { h, icon } from './ui.js';
import * as store from './store.js';
import { longDate, shiftKey } from './dates.js';
import { createAssist } from './assist.js';

let open = null;

export function openEditor(startKey, { onOpenBook, openSettings } = {}) {
  if (open) open.close();
  let key = startKey;

  const title = h('div.ed-title');
  const area = h('textarea.ed-text', {
    rows: 8,
    placeholder: 'What happened today? Type, or tap Dictate and just talk — then Summarize to boil it down to a line.',
    spellcheck: 'true',
    'aria-label': 'Entry text',
  });
  const meta = h('div.ed-meta');
  const target = {
    get key() { return key; },
    get label() { return ''; },
    get: () => store.normalize(area.value),
    set(text, { raw } = {}) {
      area.value = text;
      store.setText(key, text, raw === undefined ? {} : { raw });
      updateMeta();
    },
  };
  const assist = createAssist({ openSettings, onDone: () => dlg.close() });
  assist.setTarget(target);

  function updateMeta() {
    const n = area.value.trim().length;
    const goal = store.getSettings().ai.summaryChars;
    meta.textContent = n ? `${n} characters${n > goal * 1.6 ? ' · long for one line — try Summarize' : ''}` : '';
    meta.classList.toggle('warn', n > goal * 1.6);
  }
  function load(k) {
    key = k;
    title.textContent = longDate(k);
    area.value = store.getText(k);
    assist.setTarget(target);
    updateMeta();
  }
  area.addEventListener('input', () => { store.setText(key, area.value); updateMeta(); assist.refresh(); });

  const dlg = h('dialog.sheet.editor',
    h('div.sheet-head',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Previous day', onclick: () => load(shiftKey(key, -1)) }, icon('left')),
      title,
      h('button.icon-btn', { type: 'button', 'aria-label': 'Next day', onclick: () => load(shiftKey(key, 1)) }, icon('right')),
      h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'))),
    h('div.sheet-body', area, meta),
    onOpenBook && h('div.sheet-foot',
      h('button.btn.ghost', { type: 'button', onclick: () => { const k = key; dlg.close(); onOpenBook(k); } }, icon('book', 18), 'Open in the book')),
    assist.el);

  dlg.addEventListener('close', () => { assist.cancel(); store.flush(); dlg.remove(); open = null; });
  document.body.append(dlg);
  dlg.showModal();
  load(startKey);
  setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 60);
  open = dlg;
  return dlg;
}

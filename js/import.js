// Photo import: turn pictures of your old One Line a Day books into entries.
import { h, icon, toast } from './ui.js';
import * as store from './store.js';
import { PROVIDERS, readJournalPhoto, testChatKey } from './ai.js';
import { createModelPicker } from './modelpicker.js';
import { dateKey, validDate, MONTHS_SHORT, today } from './dates.js';
import { bootStore } from './storage/boot.js';

await bootStore();

document.documentElement.dataset.hand = store.getSettings().hand;
const s = () => store.getSettings();
let provider = s().importAi.provider;
const photos = []; // {id, file, dataUrl, status, cls}
let rows = [];     // {include, y, m, d, text, note}

// ---- step 1: model --------------------------------------------------------
const picker = createModelPicker({
  provider: () => provider,
  selected: () => (s().importAi.provider === provider ? s().importAi.model : ''),
  onSelect: (m) => { store.updateSettings({ importAi: { provider, model: m.id } }); updateReady(); },
  visionOnly: true,
});
const keyInput = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'API key', onchange: (e) => { store.updateSettings({ keys: { [provider]: e.target.value.trim() } }); updateReady(); } });
const keyStatus = h('span.key-status');
const providerSeg = h('div.seg');
function paintProvider() {
  providerSeg.replaceChildren(...Object.entries(PROVIDERS).map(([k, v]) => h('button' + (k === provider ? '.on' : ''), {
    type: 'button',
    onclick: () => { provider = k; store.updateSettings({ importAi: { provider: k, model: s().importAi.provider === k ? s().importAi.model : '' } }); paintProvider(); keyInput.value = s().keys[k] || ''; picker.providerChanged(); updateReady(); },
  }, v.label)));
}
keyInput.value = s().keys[provider] || '';
paintProvider();

const stepModel = h('section.card',
  h('h2', '1 · Choose a vision model'),
  h('p.hint', 'Handwriting is read by an AI model that can see images. Models marked VISION are listed with their prices — a page photo costs a fraction of a cent to a few cents.'),
  h('div.field', h('label', 'Provider'), providerSeg),
  h('div.field', h('label', 'API key (shared with the main app’s settings)'),
    h('div.key-row', keyInput, h('button.btn.small', { type: 'button', onclick: async () => {
      const k = keyInput.value.trim();
      store.updateSettings({ keys: { [provider]: k } });
      keyStatus.className = 'key-status'; keyStatus.textContent = 'Checking…';
      try { await testChatKey(provider, k); keyStatus.textContent = '✓ Works'; keyStatus.className = 'key-status ok'; }
      catch (e) { keyStatus.textContent = `✗ ${e.message}`; keyStatus.className = 'key-status bad'; }
      updateReady();
    } }, 'Test')), keyStatus),
  h('div.field', h('label', 'Model'), picker.el));

// ---- step 2: photos -------------------------------------------------------
const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
const drop = h('label.drop', icon('camera', 32), h('b', 'Add photos'), h('span', 'Tap to choose, or drop images here. One photo per open spread works best — keep the page flat and well lit.'), fileInput);
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
const thumbs = h('div.thumbs');
const readBtn = h('button.btn.primary', { type: 'button', onclick: readAll }, icon('sparkles', 18), 'Read the photos');
const defaultYear = h('input', { type: 'text', inputmode: 'numeric', value: String(today().y), style: { width: '5em' } });
const stepPhotos = h('section.card', h('h2', '2 · Add photos of your pages'), drop, thumbs,
  h('div.import-bar', readBtn, h('label.hint', 'If a year is unreadable, assume ', defaultYear)));

// ---- step 3: review -------------------------------------------------------
const tbody = h('tbody');
const policy = h('select', h('option', { value: 'keep' }, 'Keep what’s already in the app'), h('option', { value: 'replace' }, 'Replace with the imported text'), h('option', { value: 'append' }, 'Add the imported text after what’s there'));
const saveBtn = h('button.btn.primary', { type: 'button', onclick: save }, icon('check', 18), 'Save to my journal');
const stepReview = h('section.card', { hidden: true },
  h('h2', '3 · Check what was found'),
  h('p.hint', 'Fix any misread words, dates or years. Untick a row to skip it.'),
  h('table.found', h('thead', h('tr', h('th', ''), h('th', 'Month'), h('th', 'Day'), h('th', 'Year'), h('th', 'Entry'))), tbody),
  h('div.import-bar', h('label', 'If a day already has text: ', policy), h('span.grow'), saveBtn));

const doneCard = h('section.card', { hidden: true });

const app = document.getElementById('app');
app.append(h('div.import-wrap',
  h('a.back', { href: './' }, icon('arrowLeft', 18), 'Back to the book'),
  h('h1', 'Import from photos'),
  h('p.lede', 'Snap pictures of your paper One Line a Day books and let a vision model read the handwriting into your digital copy. You always get to review before anything is saved.'),
  stepModel, stepPhotos, stepReview, doneCard));

// ---- photos ----------------------------------------------------------------
async function toDataUrl(file, max = 1800) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Could not open that image.');
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.86);
}

async function addFiles(list) {
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue;
    const p = { id: crypto.randomUUID(), file, dataUrl: '', status: 'Preparing…', cls: '' };
    photos.push(p);
    renderThumbs();
    try { p.dataUrl = await toDataUrl(file); p.status = 'Ready'; } catch (e) { p.status = e.message; p.cls = 'bad'; }
    renderThumbs();
  }
  updateReady();
}

function renderThumbs() {
  thumbs.replaceChildren(...photos.map((p) => h('div.thumb',
    p.dataUrl && h('img', { src: p.dataUrl, alt: '' }),
    h('button.rm', { type: 'button', 'aria-label': 'Remove photo', onclick: () => { photos.splice(photos.indexOf(p), 1); renderThumbs(); updateReady(); } }, icon('x', 16)),
    h('div.st' + (p.cls ? '.' + p.cls : ''), p.status))));
}

function updateReady() {
  const ok = photos.some((p) => p.dataUrl) && s().importAi.model && s().keys[provider];
  readBtn.disabled = !ok;
  readBtn.title = ok ? '' : 'Choose a model, add your key and at least one photo';
}
updateReady();

// ---- reading ---------------------------------------------------------------
async function readAll() {
  const ready = photos.filter((p) => p.dataUrl);
  if (!ready.length) return;
  readBtn.disabled = true;
  rows = [];
  const fallbackYear = parseInt(defaultYear.value, 10) || today().y;
  let next = 0;
  async function worker() {
    while (next < ready.length) {
      const p = ready[next++];
      p.status = 'Reading…'; p.cls = ''; renderThumbs();
      try {
        const pages = await readJournalPhoto(p.dataUrl, { provider, model: s().importAi.model });
        let n = 0;
        for (const pg of pages) {
          for (const e of pg.entries || []) {
            if (!e?.text) continue;
            rows.push({ include: true, y: Number(e.year) || fallbackYear, m: Number(pg.month) || 1, d: Number(pg.day) || 1, text: String(e.text).trim(), guessedYear: !Number(e.year) });
            n++;
          }
        }
        p.status = n ? `Found ${n} ${n === 1 ? 'entry' : 'entries'}` : 'No handwriting found'; p.cls = n ? 'ok' : 'bad';
      } catch (err) {
        p.status = err.message; p.cls = 'bad';
      }
      renderThumbs();
    }
  }
  await Promise.all([worker(), worker()]);
  rows.sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d);
  renderRows();
  stepReview.hidden = !rows.length;
  readBtn.disabled = false;
  updateReady();
  if (rows.length) stepReview.scrollIntoView({ behavior: 'smooth' });
  else toast('Nothing could be read. Try a sharper photo or a different model.', { ms: 5000 });
}

function renderRows() {
  tbody.replaceChildren(...rows.map((r) => {
    const key = () => dateKey(r.y, r.m - 1, r.d);
    const note = h('div.conflict');
    const refresh = () => {
      const ok = validDate(r.y, r.m - 1, r.d);
      const existing = ok ? store.getText(key()) : '';
      const ty = today().y;
      note.textContent = !ok ? 'That date doesn’t exist.' : (r.y < ty - 4 || r.y > ty) ? `Year ${r.y} is outside the five-year book (${ty - 4}–${ty}). Is it a misread year?` : existing && existing !== r.text ? `Already has text: “${existing.slice(0, 60)}${existing.length > 60 ? '…' : ''}”` : '';
    };
    const num = (prop, min, max, w) => h('input', { type: 'number', min, max, value: r[prop], style: w && { width: w }, oninput: (e) => { r[prop] = +e.target.value; refresh(); } });
    const tr = h('tr' + (r.include ? '' : '.skip'),
      h('td', h('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Include', onchange: (e) => { r.include = e.target.checked; tr.classList.toggle('skip', !r.include); } })),
      h('td', num('m', 1, 12)), h('td', num('d', 1, 31)), h('td', num('y', 1900, 2100, '5.4em')),
      h('td.txt', h('textarea', { oninput: (e) => { r.text = e.target.value; refresh(); } }, r.text), note));
    refresh();
    return tr;
  }));
}

function save() {
  let saved = 0, skipped = 0, bad = 0;
  for (const r of rows) {
    if (!r.include) continue;
    if (!validDate(r.y, r.m - 1, r.d)) { bad++; continue; }
    const k = dateKey(r.y, r.m - 1, r.d);
    const cur = store.getText(k);
    const text = r.text.trim();
    if (!text) continue;
    if (cur && cur !== text) {
      if (policy.value === 'keep') { skipped++; continue; }
      store.setText(k, policy.value === 'append' ? `${cur}\n${text}` : text);
    } else if (!cur) store.setText(k, text);
    saved++;
  }
  store.flush();
  doneCard.hidden = false;
  doneCard.replaceChildren(
    h('h2', 'Saved'),
    h('p', `${saved} ${saved === 1 ? 'entry' : 'entries'} saved${skipped ? `, ${skipped} left as they were` : ''}${bad ? `, ${bad} skipped for invalid dates` : ''}.`),
    h('div.row', h('a.btn.primary', { href: './' }, icon('book', 18), 'Open the book'), h('button.btn', { type: 'button', onclick: () => { rows = []; photos.length = 0; renderThumbs(); stepReview.hidden = true; doneCard.hidden = true; updateReady(); } }, 'Import more')));
  doneCard.scrollIntoView({ behavior: 'smooth' });
}

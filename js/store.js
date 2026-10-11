// Local storage for entries + settings. Everything lives in this browser.
import { today, pageOfKey, parseKey, LAST } from './dates.js';

const EK = 'olad.entries.v1';
const SK = 'olad.settings.v1';

export const DEFAULTS = {
  layout: 'sofar',      // 'sofar' = only years so far, 'five' = all five rows
  startYear: 'auto',    // 'auto' = earliest year with entries, or a number
  pages: 'auto',        // 'auto' | 'single' | 'spread'
  writing: 'book',      // 'book' | 'comfy' | 'large'
  hand: 'caveat',       // 'caveat' | 'kalam' | 'patrick' | 'clean'
  skipCover: false,
  owner: '',
  keys: { groq: '', openrouter: '', deepinfra: '' },
  whisper: { model: 'whisper-large-v3-turbo', language: '' },
  ai: { provider: 'openrouter', model: '', summaryChars: 200, extra: '' },
  importAi: { provider: 'openrouter', model: '' },
  autoSummarize: false,
  lastBackup: 0,
};

const listeners = new Set();
const settingListeners = new Set();
const errorListeners = new Set();
let entries = {};
let settings = structuredClone(DEFAULTS);
let version = 0;
let timer = null;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function mergeSettings(saved) {
  const out = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(saved || {})) {
    if (!(k in out)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...out[k], ...v } : v;
  }
  return out;
}
function loadAll() {
  entries = read(EK, {});
  settings = mergeSettings(read(SK, {}));
  version++;
}
loadAll();

function persistNow() {
  clearTimeout(timer);
  timer = null;
  try {
    localStorage.setItem(EK, JSON.stringify(entries));
  } catch (err) {
    errorListeners.forEach((fn) => fn(err));
  }
}
function schedulePersist() {
  clearTimeout(timer);
  timer = setTimeout(persistNow, 350);
}
export const flush = () => { if (timer) persistNow(); };
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
// Another tab (or the photo-import page) changed data.
addEventListener('storage', (e) => {
  if (e.key === EK || e.key === SK) {
    loadAll();
    listeners.forEach((fn) => fn(null));
    settingListeners.forEach((fn) => fn());
  }
});

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onSettings = (fn) => { settingListeners.add(fn); return () => settingListeners.delete(fn); };
export const onStoreError = (fn) => { errorListeners.add(fn); return () => errorListeners.delete(fn); };

export const normalize = (t) => String(t ?? '').replace(/\r/g, '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trimEnd();

// ---- entries ---------------------------------------------------------------
export const getText = (k) => entries[k]?.t || '';
export const getRaw = (k) => entries[k]?.r || '';
export const hasEntry = (k) => !!entries[k]?.t;
export const entryCount = () => Object.keys(entries).length;

export function setText(k, text, { raw } = {}) {
  text = normalize(text);
  if (!text) {
    delete entries[k];
  } else {
    const e = (entries[k] ||= {});
    e.t = text;
    e.u = Date.now();
    if (raw !== undefined) { if (raw) e.r = raw; else delete e.r; }
  }
  version++;
  schedulePersist();
  listeners.forEach((fn) => fn(k));
}

let idx = null;
function index() {
  if (idx && idx.v === version) return idx;
  const years = new Set();
  const perPage = new Array(LAST + 1).fill(0);
  const keys = [];
  for (const k of Object.keys(entries)) {
    if (!entries[k]?.t) continue;
    keys.push(k);
    years.add(+k.slice(0, 4));
    perPage[pageOfKey(k)]++;
  }
  keys.sort();
  idx = { v: version, years: [...years].sort((a, b) => a - b), perPage, keys };
  return idx;
}
export const entryYears = () => index().years;
export const filledPerPage = () => index().perPage;
export const sortedKeys = () => index().keys;

// ---- which year rows the book shows ----------------------------------------
export function bookYears() {
  const cy = today().y;
  const ys = entryYears();
  let base = settings.startYear === 'auto' ? Math.min(ys[0] ?? cy, cy) : +settings.startYear;
  if (settings.startYear === 'auto' && cy - base > 4) base = cy - 4; // the five-year book is full
  const inWindow = ys.filter((y) => y >= base && y <= base + 4);
  const last = settings.layout === 'five'
    ? base + 4
    : Math.min(base + 4, Math.max(base, cy, inWindow.at(-1) ?? base));
  const out = [];
  for (let y = base; y <= last; y++) out.push(y);
  return out;
}

// ---- settings --------------------------------------------------------------
export const getSettings = () => settings;
export function updateSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    settings[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...settings[k], ...v } : v;
  }
  try { localStorage.setItem(SK, JSON.stringify(settings)); } catch (err) { errorListeners.forEach((fn) => fn(err)); }
  settingListeners.forEach((fn) => fn());
}

// ---- backup / restore ------------------------------------------------------
export function exportData() {
  flush();
  return JSON.stringify({ app: 'one-line-a-day', version: 1, exportedAt: new Date().toISOString(), entries }, null, 1);
}

/** mode: 'merge' (keep existing on conflict), 'overwrite' (incoming wins), 'replace' (wipe first). */
export function importData(json, mode = 'merge') {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const incoming = data?.entries;
  if (!incoming || typeof incoming !== 'object') throw new Error('This file does not look like a One Line a Day backup.');
  if (mode === 'replace') entries = {};
  let added = 0, updated = 0, skipped = 0;
  for (const [k, e] of Object.entries(incoming)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const t = normalize(typeof e === 'string' ? e : e?.t);
    if (!t) continue;
    const cur = entries[k]?.t;
    if (cur && cur !== t && mode === 'merge') { skipped++; continue; }
    if (cur === t) continue;
    entries[k] = { t, u: e?.u || Date.now(), ...(e?.r ? { r: e.r } : {}) };
    cur ? updated++ : added++;
  }
  version++;
  persistNow();
  listeners.forEach((fn) => fn(null));
  return { added, updated, skipped };
}

export function clearEntries() {
  entries = {};
  version++;
  persistNow();
  listeners.forEach((fn) => fn(null));
}

export const markBackup = () => updateSettings({ lastBackup: Date.now() });

export function stats() {
  const keys = sortedKeys();
  const t = today();
  const set = new Set(keys);
  let words = 0;
  for (const k of keys) words += entries[k].t.trim().split(/\s+/).length;
  // streaks over actual calendar days
  const dayMs = 86400000;
  const asNum = (k) => { const { y, m, d } = parseKey(k); return Math.round(Date.UTC(y, m, d) / dayMs); };
  let longest = 0, run = 0, prev = null;
  for (const k of keys) {
    const n = asNum(k);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }
  // current streak counts back from today (or yesterday if today isn't written yet)
  let cur = 0;
  let n = asNum(t.key);
  if (!set.has(t.key)) n -= 1;
  const byNum = new Set(keys.map(asNum));
  while (byNum.has(n)) { cur++; n--; }
  return { total: keys.length, words, longest, current: cur };
}

// The app's data layer: an in-memory cache with a synchronous API for the UI, persisted through a
// pluggable storage adapter (js/storage/local.js or js/storage/firebase.js).
//
//  • entries   keyed by 'YYYY-MM-DD' → { t: text, r?: original text before summarizing, u: updatedAt ms }
//  • settings  split in two: SYNCED preferences go through the adapter (cloud when Firebase is on);
//              DEVICE settings (API keys, page layout, writing size…) always stay in this browser.
import { today, pageOfKey, parseKey, LAST } from './dates.js';

const DK = 'olad.device.v1';
const LEGACY_SK = 'olad.settings.v1'; // older versions kept everything in here

export const DEFAULTS = {
  // synced
  layout: 'sofar',      // 'sofar' = only years so far, 'five' = all five rows
  startYear: 'auto',    // 'auto' = earliest year with entries, or a number
  hand: 'caveat',       // 'caveat' | 'kalam' | 'patrick' | 'clean'
  owner: '',
  whisper: { model: 'whisper-large-v3-turbo', language: '' },
  ai: { provider: 'openrouter', model: '', summaryChars: 200, extra: '' },
  autoSummarize: false,
  // device-only
  pages: 'auto',        // 'auto' | 'single' | 'spread'
  writing: 'book',      // 'book' | 'comfy' | 'large'
  skipCover: false,
  book3d: true,         // realistic WebGL book (falls back to the flat book if unavailable)
  keys: { groq: '', openrouter: '', deepinfra: '' },
  importAi: { provider: 'openrouter', model: '' },
  lastBackup: 0,
};
const DEVICE_KEYS = ['pages', 'writing', 'skipCover', 'book3d', 'keys', 'importAi', 'lastBackup'];
const SYNCED_KEYS = Object.keys(DEFAULTS).filter((k) => !DEVICE_KEYS.includes(k));

const listeners = new Set();
const settingListeners = new Set();
const errorListeners = new Set();
const statusListeners = new Set();

let adapter = null;
let unsubscribe = null;
let entries = {};
const settings = structuredClone(DEFAULTS);
let version = 0;
let timer = null;
let settingsTimer = null;
const dirty = new Set();
let pending = 0;
let status = 'saved'; // 'saved' | 'saving' | 'error'

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function pick(obj, keys) { const o = {}; for (const k of keys) if (k in obj) o[k] = obj[k]; return o; }
function applySettings(src, keys) {
  for (const k of keys) {
    if (!(k in (src || {}))) continue;
    settings[k] = isObj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...src[k] } : src[k];
  }
}
function readLocal(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function loadDeviceSettings(legacy) {
  let dev = readLocal(DK);
  if (!dev) {
    // First run after upgrading: older versions kept everything in one blob. Move the device-only
    // options (notably API keys) into their own blob right away so a later synced save can't drop them.
    dev = pick(legacy || readLocal(LEGACY_SK) || {}, DEVICE_KEYS);
    try { localStorage.setItem(DK, JSON.stringify(dev)); } catch { /* quota: retried on next change */ }
  }
  applySettings(dev, DEVICE_KEYS);
}
function sanitize(map) {
  const out = {};
  for (const [k, e] of Object.entries(map || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && e?.t) out[k] = e;
  return out;
}
const emit = (k) => listeners.forEach((fn) => fn(k));
const emitSettings = () => settingListeners.forEach((fn) => fn());

// ---- lifecycle ---------------------------------------------------------------
/** Must be awaited once before the UI starts. Safe to call again with a different adapter. */
export async function init(a) {
  unsubscribe?.();
  clearTimeout(timer); clearTimeout(settingsTimer);
  dirty.clear();
  adapter = a;
  const data = await adapter.load();
  entries = sanitize(data.entries);
  Object.assign(settings, structuredClone(DEFAULTS));
  applySettings(data.settings, SYNCED_KEYS);
  loadDeviceSettings(adapter.name === 'local' ? data.settings : null);
  version++;
  unsubscribe = adapter.subscribe?.(onRemote) || null;
  emit(null);
  emitSettings();
  return adapter;
}

/** A change arrived from outside this tab (another device, tab, or the import page). */
function onRemote(msg) {
  let changed = false;
  if (msg.replaceAll) {
    entries = sanitize(msg.entries);
    dirty.clear();
    changed = true;
  } else {
    for (const [k, e] of Object.entries(msg.entries || {})) {
      if (dirty.has(k)) continue; // we have newer unsent edits for this day
      const cur = entries[k];
      if (e) {
        if (cur && cur.t === e.t && cur.r === e.r) continue;
        entries[k] = e;
      } else if (cur) delete entries[k];
      else continue;
      changed = true;
    }
  }
  if (changed) { version++; emit(null); }
  if (msg.settings) { applySettings(msg.settings, SYNCED_KEYS); emitSettings(); }
}

addEventListener('storage', (e) => {
  if (e.key === DK) { loadDeviceSettings(); emitSettings(); }
});

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onSettings = (fn) => { settingListeners.add(fn); return () => settingListeners.delete(fn); };
export const onStoreError = (fn) => { errorListeners.add(fn); return () => errorListeners.delete(fn); };
export const onStatus = (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
export const getStatus = () => status;
export const getBackend = () => ({ name: adapter?.name || 'local', user: adapter?.user?.() || null, signOut: adapter?.signOut });

function setStatus(s) { if (s !== status) { status = s; statusListeners.forEach((fn) => fn(s)); } }
function track(promise) {
  pending++;
  setStatus('saving');
  Promise.resolve(promise).then(
    () => { if (--pending === 0 && status !== 'error') setStatus('saved'); },
    (err) => { pending--; setStatus('error'); errorListeners.forEach((fn) => fn(err)); },
  );
}

// ---- persistence -------------------------------------------------------------
function persistNow() {
  clearTimeout(timer);
  timer = null;
  if (!dirty.size || !adapter) return;
  const changes = {};
  for (const k of dirty) changes[k] = entries[k] ? { ...entries[k] } : null;
  dirty.clear();
  track(adapter.saveEntries(changes));
}
function markDirty(k) { dirty.add(k); clearTimeout(timer); timer = setTimeout(persistNow, 350); }
export function flush() {
  if (timer) persistNow();
  if (settingsTimer) { clearTimeout(settingsTimer); settingsTimer = null; saveSyncedSettings(); }
}
function saveSyncedSettings() { if (adapter) track(adapter.saveSettings(pick(settings, SYNCED_KEYS))); }
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// ---- entries -----------------------------------------------------------------
export const normalize = (t) => String(t ?? '').replace(/\r/g, '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trimEnd();
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
  markDirty(k);
  emit(k);
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

// ---- which year rows the book shows -------------------------------------------
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

// ---- settings ----------------------------------------------------------------
export const getSettings = () => settings;
export function updateSettings(patch) {
  let syncedChanged = false, deviceChanged = false;
  for (const [k, v] of Object.entries(patch)) {
    settings[k] = isObj(v) ? { ...settings[k], ...v } : v;
    if (DEVICE_KEYS.includes(k)) deviceChanged = true; else syncedChanged = true;
  }
  if (deviceChanged) {
    try { localStorage.setItem(DK, JSON.stringify(pick(settings, DEVICE_KEYS))); } catch (err) { errorListeners.forEach((fn) => fn(err)); }
  }
  if (syncedChanged) { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => { settingsTimer = null; saveSyncedSettings(); }, 400); }
  emitSettings();
}

// ---- backup / restore --------------------------------------------------------
export function exportData() {
  flush();
  return JSON.stringify({ app: 'one-line-a-day', version: 1, exportedAt: new Date().toISOString(), entries }, null, 1);
}

/** mode: 'merge' (keep existing on conflict), 'overwrite' (incoming wins), 'replace' (wipe first). */
export function importData(json, mode = 'merge') {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const incoming = data?.entries;
  if (!incoming || typeof incoming !== 'object') throw new Error('This file does not look like a One Line a Day backup.');
  if (mode === 'replace') {
    for (const k of Object.keys(entries)) { delete entries[k]; markDirty(k); }
  }
  let added = 0, updated = 0, skipped = 0;
  for (const [k, e] of Object.entries(incoming)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const t = normalize(typeof e === 'string' ? e : e?.t);
    if (!t) continue;
    const cur = entries[k]?.t;
    if (cur && cur !== t && mode === 'merge') { skipped++; continue; }
    if (cur === t) continue;
    entries[k] = { t, u: e?.u || Date.now(), ...(e?.r ? { r: e.r } : {}) };
    markDirty(k);
    cur ? updated++ : added++;
  }
  version++;
  persistNow();
  emit(null);
  return { added, updated, skipped };
}

export function clearEntries() {
  entries = {};
  dirty.clear();
  clearTimeout(timer);
  version++;
  if (adapter) track(adapter.clearAll());
  emit(null);
}

export const markBackup = () => updateSettings({ lastBackup: Date.now() });

export function stats() {
  const keys = sortedKeys();
  const t = today();
  const set = new Set(keys);
  let words = 0;
  for (const k of keys) words += entries[k].t.trim().split(/\s+/).length;
  const dayMs = 86400000;
  const asNum = (k) => { const { y, m, d } = parseKey(k); return Math.round(Date.UTC(y, m, d) / dayMs); };
  let longest = 0, run = 0, prev = null;
  for (const k of keys) {
    const n = asNum(k);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }
  let cur = 0;
  let n = asNum(t.key);
  if (!set.has(t.key)) n -= 1;
  const byNum = new Set(keys.map(asNum));
  while (byNum.has(n)) { cur++; n--; }
  return { total: keys.length, words, longest, current: cur };
}

// Tiny UI toolkit: hyperscript helper, icons, toasts, dialogs, misc utils.

export function h(sel, props, ...kids) {
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(sel);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '#') el.id = part.slice(1);
      else el.classList.add(part.slice(1));
    }
  }
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const debounce = (fn, ms) => {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
};

const ICONS = {
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  closed: '<path d="M5 19.5V4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5"/><path d="M5 21.5A2.5 2.5 0 0 0 7.5 22H19v-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  today: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8.5 16l2.5 2.5 4.5-4.5"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15v4M17 17h4M5 17v3M3.5 18.5h3"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 7.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4-.9"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-7 0-3.5-2-5.5-3.5-7.5C14.5 6 14 4 14 2c-3 2-6 6-6 10 0 1 .3 2 1 3-1.5-.5-2-2-2-3-2 2-2 4-2 5 0 3.5 3 7 7 7z"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

let toastHost;
export function toast(msg, { action, onAction, ms = 3800 } = {}) {
  if (!toastHost) toastHost = document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h('div.toast', h('span', msg));
  if (action) {
    t.append(h('button', { type: 'button', onclick: () => { onAction?.(); close(); } }, action));
  }
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const close = () => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 300);
  };
  setTimeout(close, ms);
  return close;
}

export function confirmDialog(message, { ok = 'OK', cancel = 'Cancel', danger = false, title } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog.sheet.small',
      h('div.sheet-body',
        title && h('h3', title),
        h('p', message),
        h('div.row.end',
          h('button.btn', { type: 'button', onclick: () => dlg.close('no') }, cancel),
          h('button.btn.primary' + (danger ? '.danger' : ''), { type: 'button', onclick: () => dlg.close('yes') }, ok))));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'yes'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
export const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

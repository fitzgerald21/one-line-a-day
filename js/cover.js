// The teal cloth cover with its gold-foil frame, and the endpaper title page.
import { h } from './ui.js';
import { coverOf, clothCss, shade, isLight } from './covers.js';
import * as store from './store.js';

let svgSeq = 0;
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function itemSVG(it, foil, acc) {
  if (it.items) return `<g transform="matrix(${it.m.join(' ')})">${it.items.map((i) => itemSVG(i, foil, acc)).join('')}</g>`;
  const paint = it.acc ? acc : foil;
  if (it.s) {
    const anchor = it.a || 'middle';
    const face = it.f === 'serif' ? `font-family="'Cormorant Garamond', Georgia, serif" font-style="italic"` : '';
    return `<text x="${it.x}" y="${it.y}" font-size="${it.size}" text-anchor="${anchor}" textLength="${it.w}" lengthAdjust="spacingAndGlyphs" font-weight="${it.weight || 500}" ${face} fill="${paint}">${esc(it.s)}</text>`;
  }
  if (it.fill) return `<path d="${it.d}" fill="${paint}" stroke="none"/>`;
  return it.lw ? `<path d="${it.d}" fill="none" stroke="${paint}" stroke-width="${it.lw}"/>` : '';
}

export function coverSVG(id) {
  const cv = coverOf(id);
  const gid = `cvFoil${++svgSeq}`;
  const foil = `url(#${gid})`, acc = cv.accent || foil;
  const [a, b, c, d] = cv.foil;
  return `<svg viewBox="0 0 300 480" xmlns="http://www.w3.org/2000/svg" class="cover-art" aria-label="One Line a Day, a five-year memory book" role="img">
  <defs>
    <linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="50" y1="100" x2="250" y2="280">
      <stop offset="0" stop-color="${a}"/><stop offset=".35" stop-color="${b}"/>
      <stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${d}"/>
    </linearGradient>
  </defs>
  <g stroke-linejoin="round" stroke-linecap="round" font-family="Jost, Futura, 'Century Gothic', 'Avenir Next', sans-serif">
    ${cv.art.map((it) => itemSVG(it, foil, acc)).join('\n    ')}
  </g>
</svg>`;
}

/** Apply a cover's colours to the page: the cloth texture used by the flat book, the sign-in card and the brand mark. */
export function applyCoverTheme(id) {
  const cv = coverOf(id), root = document.documentElement.style;
  root.setProperty('--cloth', `var(--cloth-noise), ${clothCss(cv)}`);
  [0.84, 0.75, 0.67, 0.58].forEach((f, i) => root.setProperty(`--cover-edge-${i + 1}`, shade(cv.cloth[1], f)));
  root.setProperty('--brand-ink', cv.metal ? cv.foil[0] : '#f1dc97');
  document.documentElement.dataset.cover = isLight(cv) ? 'light' : 'dark';
}

export function coverEl() {
  return h('div.cover-face', { html: coverSVG(store.getSettings().cover) });
}

export function endpaperEl({ owner, years, editable, onOwner }) {
  const span = years.length > 1 ? `${years[0]} – ${years.at(-1)}` : String(years[0]);
  const name = h('div.owner-name', {
    contenteditable: editable ? 'plaintext-only' : null,
    spellcheck: 'false',
    'data-ph': editable ? 'your name' : null,
  }, owner || '');
  if (editable) {
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    name.addEventListener('blur', () => onOwner?.(name.textContent.trim()));
  }
  return h('div.page.endpaper',
    h('div.ep-inner',
      h('div.ep-small', 'THIS BOOK BELONGS TO'),
      name,
      h('div.ep-rule'),
      h('div.ep-years', span),
      h('div.ep-small', 'ONE LINE A DAY')));
}

export const blankEl = (cls = '') => h('div.page.blank' + (cls ? '.' + cls : ''));

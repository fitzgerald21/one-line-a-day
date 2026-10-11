// The teal cloth cover with its gold-foil frame, and the endpaper title page.
import { h } from './ui.js';

const FOIL = `
<defs>
  <linearGradient id="cvGold" gradientUnits="userSpaceOnUse" x1="50" y1="100" x2="250" y2="280">
    <stop offset="0" stop-color="#f6e7ae"/><stop offset=".35" stop-color="#cfa954"/>
    <stop offset=".6" stop-color="#f3e0a0"/><stop offset="1" stop-color="#b98c33"/>
  </linearGradient>
</defs>`;

const orn = `
  <ellipse cx="150" cy="106" rx="9" ry="8"/>
  <ellipse cx="128" cy="110" rx="24" ry="9.5"/>
  <ellipse cx="172" cy="110" rx="24" ry="9.5"/>
  <path d="M96 118 C112 103 136 103 150 113 C164 103 188 103 204 118"/>
  <path d="M120 100 C135 94 165 94 180 100"/>`;

const scroll = `
  <path d="M86 208 C70 194 50 198 52 208 C54 218 72 216 74 208 C75 202 66 200 65 205"/>
  <path d="M86 208 H214" stroke-dasharray="1 0"/>`;

export function coverSVG() {
  return `<svg viewBox="0 0 300 480" xmlns="http://www.w3.org/2000/svg" class="cover-art" aria-label="One Line a Day, a five-year memory book" role="img">
  ${FOIL}
  <g fill="none" stroke="url(#cvGold)" stroke-linejoin="round" stroke-linecap="round">
    <path d="M105 118 H202 L254 141 V247 L202 268 H105 L52 247 V141 Z" stroke-width="1.6"/>
    <path d="M108.5 123 H198.5 L249 143.5 V244.5 L198.5 263 H108.5 L57 244.5 V143.5 Z" stroke-width=".9"/>
    <g stroke-width="1">${orn}</g>
    <g stroke-width="1" transform="translate(0 386) scale(1 -1)">${orn}</g>
    <g stroke-width="1">${scroll}</g>
    <g stroke-width="1" transform="translate(300 0) scale(-1 1)">${scroll}</g>
    <path d="M148 205 l3 3 -3 3 -3 -3z" fill="url(#cvGold)" stroke="none"/>
  </g>
  <g fill="url(#cvGold)" font-family="Jost, Futura, 'Century Gothic', 'Avenir Next', sans-serif" font-weight="500">
    <text x="153" y="167" font-size="25" text-anchor="middle" textLength="142" lengthAdjust="spacingAndGlyphs">ONE LINE</text>
    <text x="153" y="193" font-size="25" text-anchor="middle" textLength="88" lengthAdjust="spacingAndGlyphs" opacity=".92">A DAY</text>
    <text x="153" y="233" font-size="12.5" text-anchor="middle" textLength="100" lengthAdjust="spacingAndGlyphs" font-weight="400">A FIVE-YEAR</text>
    <text x="153" y="249" font-size="12.5" text-anchor="middle" textLength="116" lengthAdjust="spacingAndGlyphs" font-weight="400">MEMORY BOOK</text>
  </g>
</svg>`;
}

export function coverEl() {
  return h('div.cover-face', { html: coverSVG() });
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

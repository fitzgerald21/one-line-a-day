// The book's cover designs. Each one is a cloth colour + a foil (or ink) + an art layout, all on the same 300×480 plate.
// Pure data, no DOM: cover.js renders it as SVG (flat book, settings previews) and pagetex.js paints it on canvas (3D book).
//
// An art layout is a list of items:
//   { d, lw, fill? }                    a path (SVG path syntax); fill:true fills it, otherwise it is stroked at width lw
//   { s, x, y, size, w, weight?, f?, a?, acc? }
//                                       text stretched to w units wide; f: 'sans' | 'serif'; a: 'start' | 'middle'
//   { m:[a,b,c,d,e,f], items:[…] }      a group under an SVG matrix transform
// Any item with acc:true is painted in the theme's accent colour instead of the foil.

const f2 = (n) => Math.round(n * 100) / 100;
const ell = (cx, cy, rx, ry) => `M${f2(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
const spark = (x, y, r, k = 0.16) => `M${x} ${f2(y - r)}Q${f2(x + r * k)} ${f2(y - r * k)} ${f2(x + r)} ${y}Q${f2(x + r * k)} ${f2(y + r * k)} ${x} ${f2(y + r)}Q${f2(x - r * k)} ${f2(y + r * k)} ${f2(x - r)} ${y}Q${f2(x - r * k)} ${f2(y - r * k)} ${x} ${f2(y - r)}z`;
const diamond = (x, y, r) => `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}z`;
const line = (x1, y1, x2, y2) => `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
/** A pointed leaf from (x,y) pointing at angle a (radians, 0 = right), len long, wid wide. */
function leaf(x, y, a, len, wid) {
  const c = Math.cos(a), s = Math.sin(a);
  const P = (u, v) => `${f2(x + u * c - v * s)} ${f2(y + u * s + v * c)}`;
  return `M${P(0, 0)}C${P(len * 0.3, -wid)} ${P(len * 0.75, -wid * 0.8)} ${P(len, 0)}C${P(len * 0.75, wid * 0.8)} ${P(len * 0.3, wid)} ${P(0, 0)}z`;
}

// ---- layouts ---------------------------------------------------------------------------------------------------
const ORN = [
  { d: ell(150, 106, 9, 8), lw: 1 }, { d: ell(128, 110, 24, 9.5), lw: 1 }, { d: ell(172, 110, 24, 9.5), lw: 1 },
  { d: 'M96 118 C112 103 136 103 150 113 C164 103 188 103 204 118', lw: 1 }, { d: 'M120 100 C135 94 165 94 180 100', lw: 1 },
];
const SCROLL = [{ d: 'M86 208 C70 194 50 198 52 208 C54 218 72 216 74 208 C75 202 66 200 65 205', lw: 1 }, { d: 'M86 208 H214', lw: 1 }];

/** The original: an octagonal frame with scrollwork. */
const frame = [
  { d: 'M105 118 H202 L254 141 V247 L202 268 H105 L52 247 V141 Z', lw: 1.6 },
  { d: 'M108.5 123 H198.5 L249 143.5 V244.5 L198.5 263 H108.5 L57 244.5 V143.5 Z', lw: 0.9 },
  ...ORN, { m: [1, 0, 0, -1, 0, 386], items: ORN },
  ...SCROLL, { m: [-1, 0, 0, 1, 300, 0], items: SCROLL },
  { d: 'M148 205 l3 3 -3 3 -3 -3z', fill: true },
  { s: 'ONE LINE', x: 153, y: 167, size: 25, w: 142 },
  { s: 'A DAY', x: 153, y: 193, size: 25, w: 88 },
  { s: 'A FIVE-YEAR', x: 153, y: 233, size: 12.5, w: 100, weight: 400 },
  { s: 'MEMORY BOOK', x: 153, y: 249, size: 12.5, w: 116, weight: 400 },
];

/** Art deco: a sunburst fan inside a stepped arch. */
const deco = (() => {
  const rays = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i * Math.PI) / 12;
    rays.push({ d: line(150 + 22 * Math.cos(a), 188 + 22 * Math.sin(a), 150 + (i % 2 ? 54 : 66) * Math.cos(a), 188 + (i % 2 ? 54 : 66) * Math.sin(a)), lw: i % 2 ? 0.9 : 1.4 });
  }
  return [
    { d: 'M62 336V190A88 88 0 0 1 238 190V336Z', lw: 1.8 },
    { d: 'M71 336V190A79 79 0 0 1 229 190V336Z', lw: 0.8 },
    { d: 'M62 346H238', lw: 1.2 }, { d: 'M80 353H220', lw: 0.8 }, { d: 'M100 360H200', lw: 0.8 },
    { d: 'M128 188A22 22 0 0 1 172 188', lw: 1.2 }, { d: 'M138 188A12 12 0 0 1 162 188', lw: 0.8 },
    ...rays,
    { d: line(70, 188, 230, 188), lw: 0.8 },
    { d: diamond(150, 84, 6), fill: true }, { d: line(120, 84, 138, 84), lw: 1 }, { d: line(162, 84, 180, 84), lw: 1 },
    { d: diamond(108, 84, 2.4), fill: true }, { d: diamond(192, 84, 2.4), fill: true },
    { s: 'ONE LINE', x: 150, y: 244, size: 25, w: 124 },
    { s: 'A DAY', x: 150, y: 271, size: 25, w: 78 },
    { d: line(112, 288, 188, 288), lw: 0.8 },
    { s: 'A FIVE-YEAR', x: 150, y: 307, size: 10.5, w: 82, weight: 400 },
    { s: 'MEMORY BOOK', x: 150, y: 322, size: 10.5, w: 98, weight: 400 },
  ];
})();

/** A setting sun over ruled water, in a thin modern frame. */
const sun = (() => {
  const water = [];
  [[232, 120], [243, 98], [254, 76], [265, 54], [276, 34]].forEach(([y, w], i) => water.push({ d: line(150 - w / 2, y, 150 + w / 2, y), lw: 2.4 - i * 0.3 }));
  const rays = [];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + ((i + 0.5) * Math.PI) / 9;
    rays.push({ d: line(150 + 70 * Math.cos(a), 218 + 70 * Math.sin(a), 150 + 82 * Math.cos(a), 218 + 82 * Math.sin(a)), lw: 1.6 });
  }
  return [
    { d: 'M30 34H270V446H30Z', lw: 0.9 },
    { d: 'M92 218A58 58 0 0 1 208 218Z', fill: true },
    ...rays, ...water,
    { s: 'ONE LINE', x: 150, y: 330, size: 23, w: 132 },
    { s: 'A DAY', x: 150, y: 357, size: 23, w: 80 },
    { d: diamond(150, 376, 2.6), fill: true },
    { s: 'A FIVE-YEAR MEMORY BOOK', x: 150, y: 400, size: 9, w: 150, weight: 400 },
  ];
})();

/** A laurel wreath round the title. */
const wreath = (() => {
  const cx = 150, cy = 214, rx = 74, ry = 96;
  const items = [];
  for (const side of [1, -1]) {
    // a stem curving up one side
    let stem = '';
    for (let k = 0; k <= 34; k++) {
      const t = (k / 34) * 2.82;
      stem += `${k ? 'L' : 'M'}${f2(cx + side * rx * Math.sin(t))} ${f2(cy + ry * Math.cos(t))}`;
    }
    items.push({ d: stem, lw: 1.1 });
    for (let k = 1; k <= 14; k++) {
      const t = (k / 14) * 2.74;
      const x = cx + side * rx * Math.sin(t), y = cy + ry * Math.cos(t);
      const dir = Math.atan2(-ry * Math.sin(t), side * rx * Math.cos(t)); // direction of travel along the stem
      const len = 17 - k * 0.35;
      items.push({ d: leaf(x, y, dir + side * 0.62, len, 4.8), lw: 0.95 });
      items.push({ d: leaf(x, y, dir - side * 0.62, len * 0.92, 4.4), lw: 0.95 });
    }
  }
  return [
    ...items,
    { d: diamond(150, 108, 4.5), fill: true },
    { d: 'M150 312C138 304 124 312 128 320C132 328 146 322 150 312C154 322 168 328 172 320C176 312 162 304 150 312Z', lw: 1 },
    { d: 'M150 312C146 326 140 334 134 340M150 312C154 326 160 334 166 340', lw: 1 },
    { s: 'ONE LINE', x: 150, y: 204, size: 22, w: 104 },
    { s: 'A DAY', x: 150, y: 229, size: 22, w: 64 },
    { d: line(122, 242, 178, 242), lw: 0.8 }, { d: diamond(150, 242, 2.2), fill: true },
    { s: 'A FIVE-YEAR', x: 150, y: 260, size: 9.5, w: 70, weight: 400 },
    { s: 'MEMORY BOOK', x: 150, y: 273, size: 9.5, w: 82, weight: 400 },
  ];
})();

/** A crescent moon among sparkles. */
const celestial = (() => {
  // crescent: outer circle (c1,R) minus an offset circle (c2,r); both pass through the two tips
  const c1 = [150, 168], R = 50, c2 = [166, 158], r = 42;
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d), hgt = Math.sqrt(R * R - a * a);
  const mx = c1[0] + (a * dx) / d, my = c1[1] + (a * dy) / d;
  const p1 = [mx + (hgt * dy) / d, my - (hgt * dx) / d], p2 = [mx - (hgt * dy) / d, my + (hgt * dx) / d];
  const moon = `M${f2(p1[0])} ${f2(p1[1])}A${R} ${R} 0 1 0 ${f2(p2[0])} ${f2(p2[1])}A${r} ${r} 0 1 1 ${f2(p1[0])} ${f2(p1[1])}Z`;
  const dots = [[96, 92], [212, 96], [226, 176], [72, 190], [190, 232], [104, 236], [128, 82], [236, 130], [64, 138]];
  return [
    { d: 'M40 40H260V440H40Z', lw: 0.9 }, { d: 'M46 46H254V434H46Z', lw: 0.6 },
    { d: moon, fill: true },
    { d: spark(204, 130, 11), fill: true }, { d: spark(98, 120, 7), fill: true }, { d: spark(222, 208, 5), fill: true },
    { d: spark(84, 216, 5.5), fill: true }, { d: spark(150, 250, 3.8), fill: true },
    ...dots.map(([x, y]) => ({ d: ell(x, y, 1.15, 1.15), fill: true })),
    { d: line(70, 276, 138, 276), lw: 0.9 }, { d: line(162, 276, 230, 276), lw: 0.9 }, { d: spark(150, 276, 6), fill: true },
    { s: 'ONE LINE', x: 150, y: 322, size: 25, w: 148 },
    { s: 'A DAY', x: 150, y: 349, size: 25, w: 90 },
    { s: 'A FIVE-YEAR MEMORY BOOK', x: 150, y: 382, size: 9.5, w: 160, weight: 400 },
  ];
})();

/** Letterpress on linen: a ruled page where one line has been written. */
const ruled = (() => {
  const lines = [];
  for (let i = 0; i < 10; i++) {
    const y = 218 + i * 19;
    lines.push({ d: line(46, y, 254, y), lw: i === 3 ? 1.5 : 0.6, acc: i === 3 });
  }
  return [
    { s: 'ONE LINE', x: 46, y: 126, size: 34, w: 178, a: 'start', weight: 500 },
    { s: 'A DAY', x: 46, y: 168, size: 34, w: 102, a: 'start', weight: 500 },
    ...lines,
    { d: 'M52 271c7-14 12-14 16-2s9 12 14-2 11-12 15 0 9 11 14-1 10-11 14 0 8 10 13-1 9-9 12-1', lw: 1.5, acc: true },
    { s: 'A FIVE-YEAR MEMORY BOOK', x: 46, y: 432, size: 9.5, w: 142, a: 'start', weight: 400 },
  ];
})();

// ---- the covers ------------------------------------------------------------------------------------------------
// cloth: three gradient stops (diagonal); weave: the thread colour; foil: four stops; deboss: the blind-impression shadow;
// metal: how metallic the foil is (0 = printed ink); glow: emissive tint that lets foil catch the light in 3D.
export const COVERS = {
  teal: {
    label: 'Teal & gold', art: frame,
    cloth: ['#8bb6b2', '#72a09c', '#7eaba7'], weave: '#0d2b2a',
    foil: ['#f6e7ae', '#cfa954', '#f3e0a0', '#b98c33'], deboss: 'rgba(0,30,30,.35)', metal: 1, glow: 0x8a6b22,
  },
  midnight: {
    label: 'Midnight & silver', art: deco,
    cloth: ['#3a5287', '#2e4574', '#374e80'], weave: '#050b1c',
    foil: ['#f7f9fd', '#aab6c9', '#eef2f8', '#8493ab'], deboss: 'rgba(0,4,24,.5)', metal: 1, glow: 0x5b6a85,
  },
  terracotta: {
    label: 'Terracotta & ivory', art: sun,
    cloth: ['#e0906a', '#cd7a55', '#d78561'], weave: '#3a1608',
    foil: ['#fffaec', '#f0dcae', '#fffdf4', '#d8bf88'], deboss: 'rgba(70,22,6,.4)', metal: 0.85, glow: 0x8a7552,
  },
  forest: {
    label: 'Forest & rose gold', art: wreath,
    cloth: ['#5f8e6e', '#4d7a5c', '#58856a'], weave: '#04160b',
    foil: ['#fde0cc', '#d89b7c', '#f9d2b9', '#b97558'], deboss: 'rgba(0,24,10,.42)', metal: 1, glow: 0x8a5036,
  },
  plum: {
    label: 'Plum & champagne', art: celestial,
    cloth: ['#8f5a7e', '#7c4a6b', '#865273'], weave: '#210a1b',
    foil: ['#fcf0d4', '#dbbb7c', '#f8e8c0', '#bb9753'], deboss: 'rgba(30,6,24,.45)', metal: 1, glow: 0x8a6b22,
  },
  linen: {
    label: 'Linen & ink', art: ruled,
    cloth: ['#efe7d3', '#e3d9c1', '#eae1cb'], weave: '#8a7852',
    foil: ['#2a2f3d', '#2a2f3d', '#2a2f3d', '#2a2f3d'], accent: '#b6462e', deboss: 'rgba(255,255,255,.6)', metal: 0, glow: 0x000000,
  },
};
export const COVER_IDS = Object.keys(COVERS);
export const DEFAULT_COVER = 'teal';
export const coverOf = (id) => COVERS[id] || COVERS[DEFAULT_COVER];

// ---- colour helpers --------------------------------------------------------------------------------------------
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
export const clothCss = (cv) => `linear-gradient(135deg, ${cv.cloth[0]} 0%, ${cv.cloth[1]} 45%, ${cv.cloth[2]} 100%)`;
/** Whether the cloth is light enough that the hint text and weave should be handled the dark way round. */
export const isLight = (cv) => { const n = parseInt(cv.cloth[1].slice(1), 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) > 190; };

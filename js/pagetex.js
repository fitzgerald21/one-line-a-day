// Canvas renderers for everything that gets wrapped onto the 3D book: journal pages, the foil-stamped
// cover, the cloth, the endpaper boards. Pure canvas — no three.js in here.
//
// A page is 30 × 48 "units" (same as the CSS version); everything is drawn in units so it scales with the texture.
import { PAGES, MONTHS, WEEKDAYS_SHORT, dateKey, daysIn, weekdayOf } from './dates.js';

export const HANDS = {
  caveat: { family: 'Caveat', scale: 0.94 },
  kalam: { family: 'Kalam', scale: 0.72 },
  patrick: { family: 'Patrick Hand', scale: 0.8 },
  clean: { family: 'Jost', scale: 0.66 },
};
const INK = '#1c2f86';
const SEP = '#8ba399';
const GOLD = '#b79b55';
const UI = 'Jost, Futura, "Century Gothic", sans-serif';
const SERIF = '"Cormorant Garamond", Georgia, serif';

let TEX_W = 1024;
export const setTexWidth = (w) => { TEX_W = w; };
export const texSize = () => ({ w: TEX_W, h: Math.round(TEX_W * 1.6) });

/** Vertical layout shared with the flat (DOM) version so both look identical. */
export function slotLayout(k, writing) {
  const lhEm = { book: 1.32, comfy: 1.7, large: 2.1 }[writing] || 1.32;
  const n = Math.max(1, k);
  const lines = Math.max(2, Math.floor((41.6 - n * 0.12) / (lhEm * n)));
  return { lines, lh: lhEm, slotH: lines * lhEm + 0.1, top: 4.4 };
}

// ---- helpers -----------------------------------------------------------------
let noiseTile = null;
function noisePattern(g) {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 256;
    const ng = noiseTile.getContext('2d');
    const img = ng.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 120; img.data[i + 1] = 98; img.data[i + 2] = 58;
      img.data[i + 3] = Math.random() * Math.random() * 46;
    }
    ng.putImageData(img, 0, 0);
  }
  return g.createPattern(noiseTile, 'repeat');
}

function paper(g, w, h, u, tint = ['#fbf7ed', '#f1ebdb']) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, tint[0]); bg.addColorStop(1, tint[1]);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const hl = g.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, h * 0.75);
  hl.addColorStop(0, 'rgba(255,255,255,.5)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.fillRect(0, 0, w, h);
  g.fillStyle = noisePattern(g); g.fillRect(0, 0, w, h);
  // soft darkening toward the sheet edges
  const e = u * 2.4;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, e, 0, 0, 0, e, h], [w, 0, w - e, 0, w - e, 0, e, h], [0, 0, 0, e, 0, 0, w, e], [0, h, 0, h - e, 0, h - e, w, e]]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(122,96,48,.14)'); gr.addColorStop(1, 'rgba(122,96,48,0)');
    g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
  }
}

function gutter(g, w, h, right) {
  const x0 = right ? 0 : w, x1 = right ? w * 0.13 : w * 0.87;
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, 'rgba(50,35,10,.30)'); gr.addColorStop(0.1, 'rgba(50,35,10,.11)');
  gr.addColorStop(0.42, 'rgba(50,35,10,.035)'); gr.addColorStop(1, 'rgba(50,35,10,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

function spaced(g, text, cx, y, spacing) {
  const widths = [...text].map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  g.textAlign = 'left';
  [...text].forEach((c, i) => { g.fillText(c, x, y); x += widths[i] + spacing; });
}

function octagon(g, x, y, w, h, pts) {
  g.beginPath();
  pts.forEach(([px, py], i) => { const X = x + (px / 100) * w, Y = y + (py / 50) * h; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
  g.closePath();
}
const OUTER = [[13, 1], [87, 1], [99, 25], [87, 49], [13, 49], [1, 25]];
const INNER = [[15, 5], [85, 5], [93, 25], [85, 45], [15, 45], [7, 25]];

function wrapLines(g, text, { x0, x1, lh, maxLines, floatW, firstReserve }) {
  const out = [];
  const paras = text.split('\n');
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    const bounds = () => {
      const i = out.length;
      return [x0 + (i < 2 ? floatW : 0), x1 - (i === 0 ? firstReserve : 0)];
    };
    const flush = () => { out.push(line); line = ''; };
    if (!words.length) { out.push(''); continue; }
    for (let word of words) {
      for (;;) {
        const [l, r] = bounds();
        const trial = line ? `${line} ${word}` : word;
        if (g.measureText(trial).width <= r - l) { line = trial; break; }
        if (line) { flush(); continue; }
        // a single word wider than the line: break it
        let cut = word.length;
        while (cut > 1 && g.measureText(word.slice(0, cut)).width > r - l) cut--;
        line = word.slice(0, cut);
        word = word.slice(cut);
        flush();
        if (!word) break;
      }
      if (out.length >= maxLines + 1) break;
    }
    if (line) flush();
    if (out.length >= maxLines + 1) break;
  }
  return { lines: out.slice(0, maxLines), overflow: out.length > maxLines };
}

// ---- journal page ------------------------------------------------------------
/** env = { years: number[], writing, hand, todayKey, getText(key) } */
export function drawPage(cv, n, env) {
  const w = cv.width, h = cv.height, u = w / 30;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const right = n % 2 === 1;
  paper(g, w, h, u);
  gutter(g, w, h, right);
  const { m, d } = PAGES[n];

  // header
  g.fillStyle = '#2b3a36';
  g.font = `500 ${u * 1.12}px ${UI}`;
  g.textBaseline = 'alphabetic';
  spaced(g, `${MONTHS[m].toUpperCase()} ${d}`, w / 2, u * 3.55, u * 0.29);
  // weekday (of the newest year shown), same line, right side
  const latest = [...env.years].reverse().find((y) => d <= daysIn(y, m));
  if (latest != null) {
    const wd = WEEKDAYS_SHORT[weekdayOf(latest, m, d)].toUpperCase();
    g.font = `500 ${u * 0.95}px ${UI}`;
    g.fillStyle = dateKey(latest, m, d) === env.todayKey ? '#9a7a20' : '#6b857b';
    const sp = u * 0.2;
    const tw = [...wd].reduce((a, c) => a + g.measureText(c).width + sp, 0) - sp;
    spaced(g, wd, w - (right ? 2.1 : 1.5) * u - u * 0.3 - tw / 2, u * 3.55, sp);
  }

  const hand = HANDS[env.hand] || HANDS.caveat;
  const { lines, lh: lhEm, slotH, top } = slotLayout(env.years.length, env.writing);
  const lh = lhEm * u;
  const mL = (right ? 1.5 : 2.1) * u, mR = (right ? 2.1 : 1.5) * u;
  const x0 = mL, x1 = w - mR;

  env.years.forEach((y, i) => {
    const sy = (top + i * slotH) * u;
    const valid = d <= daysIn(y, m);
    const key = dateKey(y, m, d);
    const isToday = valid && key === env.todayKey;
    const bodyTop = sy + 0.1 * u;

    if (isToday) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(255,213,100,.30)'); gr.addColorStop(0.6, 'rgba(255,213,100,.07)'); gr.addColorStop(1, 'rgba(255,213,100,0)');
      g.fillStyle = gr; g.fillRect(x0, bodyTop, x1 - x0, lines * lh);
      g.fillStyle = '#e6c874'; g.fillRect(x0, bodyTop, u * 0.22, lines * lh);
    }
    if (!valid) {
      g.save();
      g.beginPath(); g.rect(x0, bodyTop, x1 - x0, lines * lh); g.clip();
      g.strokeStyle = 'rgba(120,140,130,.22)'; g.lineWidth = 2;
      for (let hx = x0 - lines * lh; hx < x1; hx += 9 * u / 4.5) { g.beginPath(); g.moveTo(hx, bodyTop + lines * lh); g.lineTo(hx + lines * lh, bodyTop); g.stroke(); }
      g.restore();
    }
    // ruled lines
    g.strokeStyle = 'rgba(110,140,128,.5)';
    g.lineWidth = Math.max(1, u * 0.03);
    for (let l = 1; l <= lines; l++) {
      const ly = bodyTop + l * lh - g.lineWidth / 2;
      g.beginPath(); g.moveTo(x0, ly); g.lineTo(x1, ly); g.stroke();
    }
    // separator
    g.fillStyle = SEP;
    g.fillRect(x0, sy, x1 - x0, u * 0.1);
    if (i === env.years.length - 1) g.fillRect(x0, sy + slotH * u, x1 - x0, u * 0.1);

    // year badge
    const bx = x0 + u * 0.25, by = bodyTop + u * 0.2, bw = u * 4, bh = lh * 2 - u * 0.32;
    octagon(g, bx, by, bw, bh, OUTER);
    g.fillStyle = isToday ? '#f6dc8e' : '#f6f2e7'; g.fill();
    g.strokeStyle = isToday ? '#a98530' : GOLD; g.lineWidth = Math.max(1.4, u * 0.05); g.stroke();
    octagon(g, bx, by, bw, bh, INNER);
    g.lineWidth = Math.max(1, u * 0.025); g.stroke();
    g.globalAlpha = valid ? 1 : 0.45;
    g.fillStyle = '#35433e'; g.font = `500 ${u * 1.02}px ${UI}`; g.textAlign = 'left';
    const twenty = g.measureText('20').width;
    g.font = `400 ${u * 1.5}px ${hand.family}, cursive`;
    const yy = String(y).slice(2);
    const yyW = g.measureText(yy).width;
    const gap = u * 0.2;
    const startX = bx + (bw - (twenty + gap + yyW)) / 2;
    const midY = by + bh / 2;
    g.font = `500 ${u * 1.02}px ${UI}`; g.fillStyle = '#35433e';
    g.fillText('20', startX, midY + u * 0.36);
    g.font = `400 ${u * 1.5}px ${hand.family}, cursive`; g.fillStyle = INK;
    g.fillText(yy, startX + twenty + gap, midY + u * 0.5);
    g.strokeStyle = 'rgba(70,70,70,.55)'; g.setLineDash([u * 0.07, u * 0.1]); g.lineWidth = Math.max(1, u * 0.03);
    g.beginPath(); g.moveTo(startX + twenty + gap, midY + u * 0.68); g.lineTo(startX + twenty + gap + yyW, midY + u * 0.68); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 1;

    // the weekday now lives in the page header
    const wdW = 0;
    if (!valid) {
      g.font = `500 ${u * 0.62}px ${UI}`;
      g.fillStyle = '#7d9188';
      g.textAlign = 'center';
      spaced(g, 'NOT A LEAP YEAR', (x0 + x1) / 2, bodyTop + lh * 1.7, u * 0.16);
    }

    // handwriting
    const text = valid ? env.getText(key) : '';
    if (text) {
      g.font = `400 ${lh * hand.scale}px ${hand.family}, cursive`;
      g.fillStyle = INK; g.textAlign = 'left';
      const padL = u * 0.45;
      const { lines: wrapped, overflow } = wrapLines(g, text, {
        x0: x0 + padL, x1: x1 - u * 0.5, lh, maxLines: lines, floatW: bw + u * 0.7, firstReserve: wdW,
      });
      wrapped.forEach((ln, li) => {
        const lx = x0 + padL + (li < 2 ? bw + u * 0.7 : 0);
        g.fillText(ln, lx, bodyTop + li * lh + lh * 0.74);
      });
      if (overflow) {
        g.font = `600 ${u * 1.1}px ${UI}`; g.fillStyle = GOLD; g.textAlign = 'right';
        g.fillText('⌄', x1 - u * 0.3, bodyTop + lines * lh - u * 0.1);
      }
    } else if (isToday) {
      g.font = `400 ${lh * hand.scale}px ${hand.family}, cursive`;
      g.fillStyle = 'rgba(28,47,134,.34)'; g.textAlign = 'left';
      g.fillText('Today — tap to write…', x0 + u * 0.45 + bw + u * 0.7, bodyTop + lh * 0.74);
    }
  });
}

// ---- cloth, cover, endpapers ---------------------------------------------------
export function drawCloth(cv) {
  const w = cv.width, h = cv.height, g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#8bb6b2'); bg.addColorStop(0.45, '#72a09c'); bg.addColorStop(1, '#7eaba7');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // woven cloth: faint warp + weft threads and speckle
  g.globalAlpha = 0.07;
  g.fillStyle = '#0d2b2a';
  for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  g.globalAlpha = 1;
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() - 0.5) * 22;
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
}

const ORN = ['M96 118 C112 103 136 103 150 113 C164 103 188 103 204 118', 'M120 100 C135 94 165 94 180 100'];
const SCROLL = ['M86 208 C70 194 50 198 52 208 C54 218 72 216 74 208 C75 202 66 200 65 205', 'M86 208 H214'];

/** Draws the foil art (viewBox 300×480) onto g in a single colour/gradient. */
function foilArt(g, paint, ox = 0, oy = 0) {
  g.save();
  g.translate(ox, oy);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = paint;
  g.fillStyle = paint;
  const stroke = (d, lw) => { g.lineWidth = lw; g.stroke(new Path2D(d)); };
  stroke('M105 118 H202 L254 141 V247 L202 268 H105 L52 247 V141 Z', 1.6);
  stroke('M108.5 123 H198.5 L249 143.5 V244.5 L198.5 263 H108.5 L57 244.5 V143.5 Z', 0.9);
  const ellipse = (cx, cy, rx, ry) => { g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke(); };
  const ornament = () => { ellipse(150, 106, 9, 8); ellipse(128, 110, 24, 9.5); ellipse(172, 110, 24, 9.5); ORN.forEach((d) => stroke(d, 1)); };
  ornament();
  g.save(); g.translate(0, 386); g.scale(1, -1); ornament(); g.restore();
  SCROLL.forEach((d) => stroke(d, 1));
  g.save(); g.translate(300, 0); g.scale(-1, 1); SCROLL.forEach((d) => stroke(d, 1)); g.restore();
  g.beginPath(); g.moveTo(148, 205); g.lineTo(151, 208); g.lineTo(148, 211); g.lineTo(145, 208); g.closePath(); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const text = (s, y, size, wdt, weight = 500) => {
    g.font = `${weight} ${size}px ${UI}`;
    // stretch to a fixed width, like the printed foil
    const natural = g.measureText(s).width;
    g.save(); g.translate(153, y); g.scale(wdt / natural, 1); g.fillText(s, 0, 0); g.restore();
  };
  text('ONE LINE', 167, 25, 142);
  text('A DAY', 193, 25, 88);
  text('A FIVE-YEAR', 233, 12.5, 100, 400);
  text('MEMORY BOOK', 249, 12.5, 116, 400);
  g.restore();
}

/** Cover canvases: colour map, plus metalness/roughness maps so the foil catches the light. */
export function drawCover(w, h) {
  const make = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const color = make(), metal = make(), rough = make();
  drawCloth(color);
  const sx = w / 300, sy = h / 480;
  const g = color.getContext('2d');
  g.save(); g.scale(sx, sy);
  const gold = g.createLinearGradient(50, 100, 250, 280);
  gold.addColorStop(0, '#f6e7ae'); gold.addColorStop(0.35, '#cfa954'); gold.addColorStop(0.6, '#f3e0a0'); gold.addColorStop(1, '#b98c33');
  // faint deboss shadow first, then the foil
  foilArt(g, 'rgba(0,30,30,.35)', 0.5, 0.7);
  foilArt(g, gold);
  g.restore();
  // hinge groove down the left
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(w * 0.042, 0, 2, h);
  g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(w * 0.042 + 2, 0, 1, h);

  const mg = metal.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, w, h);
  mg.save(); mg.scale(sx, sy); foilArt(mg, '#fff'); mg.restore();
  const rg = rough.getContext('2d'); rg.fillStyle = '#e8e8e8'; rg.fillRect(0, 0, w, h);
  rg.save(); rg.scale(sx, sy); foilArt(rg, '#4a4a4a'); rg.restore();
  return { color, metal, rough };
}

/** The inside of a cover: cloth turn-in with the pasted endpaper (title page on the front, plain on the back). */
export function drawInsideBoard(w, h, { title, owner, years, hand, spineOnRight }) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  drawCloth(cv);
  // paper pasted down, with a wider cloth margin on the outer edge than at the hinge
  const marginOuter = w * 0.04, marginSpine = w * 0.005, mv = h * 0.022;
  const px = spineOnRight ? marginOuter : marginSpine;
  const pw = w - marginOuter - marginSpine;
  const pc = document.createElement('canvas');
  pc.width = Math.round(pw); pc.height = Math.round(h - mv * 2);
  const pg = pc.getContext('2d');
  const u = pc.width / 30;
  paper(pg, pc.width, pc.height, u, ['#f3ecd8', '#e8dfc6']);
  gutter(pg, pc.width, pc.height, !spineOnRight);
  if (title) {
    pg.textAlign = 'center'; pg.fillStyle = '#6f7f77';
    pg.font = `500 ${u * 0.9}px ${UI}`;
    spaced(pg, 'THIS BOOK BELONGS TO', pc.width / 2, pc.height * 0.4, u * 0.3);
    pg.strokeStyle = 'rgba(60,60,50,.4)'; pg.lineWidth = 1.5;
    pg.beginPath(); pg.moveTo(pc.width * 0.15, pc.height * 0.48); pg.lineTo(pc.width * 0.85, pc.height * 0.48); pg.stroke();
    if (owner) {
      const hd = HANDS[hand] || HANDS.caveat;
      pg.font = `400 ${u * 2.2}px ${hd.family}, cursive`; pg.fillStyle = INK; pg.textAlign = 'center';
      pg.fillText(owner, pc.width / 2, pc.height * 0.465);
    }
    const lg = pg.createLinearGradient(pc.width * 0.3, 0, pc.width * 0.7, 0);
    lg.addColorStop(0, 'rgba(183,155,85,0)'); lg.addColorStop(0.5, GOLD); lg.addColorStop(1, 'rgba(183,155,85,0)');
    pg.fillStyle = lg; pg.fillRect(pc.width * 0.3, pc.height * 0.53, pc.width * 0.4, 2);
    pg.fillStyle = '#8b6f2a'; pg.font = `italic 500 ${u * 2.6}px ${SERIF}`;
    const span = years.length > 1 ? `${years[0]} – ${years.at(-1)}` : String(years[0]);
    spaced(pg, span, pc.width / 2, pc.height * 0.6, u * 0.1);
    pg.fillStyle = '#6f7f77'; pg.font = `500 ${u * 0.9}px ${UI}`;
    spaced(pg, 'ONE LINE A DAY', pc.width / 2, pc.height * 0.68, u * 0.3);
  }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(px - 1, mv - 1, pc.width + 2, pc.height + 2);
  g.drawImage(pc, px, mv);
  return cv;
}

export function drawEdge(cv) {
  // page edges seen from the side: a stack of hairlines
  const g = cv.getContext('2d');
  g.fillStyle = '#efe9d9'; g.fillRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < cv.height; y += 4) {
    g.fillStyle = y % 8 === 0 ? 'rgba(150,130,90,.38)' : 'rgba(150,130,90,.16)';
    g.fillRect(0, y, cv.width, 1);
  }
}

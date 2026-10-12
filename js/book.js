// The book: a 3D page-turner that looks like the real thing, with in-place editing.
//
// Pages are numbered like the printed book: -1 = front cover, 0 = inside cover,
// 1..366 = January 1 … December 31 (leap day included), 367 = back endpaper.
// "Spread" mode shows two pages (left = even, right = odd); "single" mode shows one.
import { h, icon, clamp, debounce } from './ui.js';
import { PAGES, LAST, MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, dateKey, daysIn, weekdayOf, today, pageOf, parseKey } from './dates.js';
import * as store from './store.js';
import { coverEl, endpaperEl, blankEl } from './cover.js';
import { createAssist } from './assist.js';

const ASPECT = 1.6;            // page height / width
const BODY_EM = 41.6;          // vertical room for the year slots (page is 30em × 48em)
const LH = { book: 1.32, comfy: 1.7, large: 2.1 }; // ruled-line spacing in em
const MAX_SPREAD = 184;
const MIN_SPREAD_PW = 290;     // narrower than this and we switch to a single page
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const spreadOf = (n) => (n < 0 ? 0 : Math.floor(n / 2) + 1);
const leftOf = (s) => (s === 0 ? null : 2 * s - 2);
const rightOf = (s) => (s === 0 ? -1 : 2 * s - 1);

export function createBook({ openSettings }) {
  const S = { page: -1, mode: 'spread', pw: 300, busy: false, flipping: null, editing: null, years: [], lines: 6, lh: 1.32, stale: false, day: today().key };

  // ---- structure ------------------------------------------------------------
  const assist = createAssist({ openSettings, onDone: () => document.activeElement?.blur?.() });
  const pgA = h('div.half.pg-a', h('div.cast'));
  const pgB = h('div.half.pg-b', h('div.cast'));
  const block = h('div.block', pgA, pgB);
  const book = h('div.book', h('div.book-shadow'), h('div.cover-base'), block);
  const scroller = h('div.book-scroller', book);
  const hint = h('div.book-hint', 'Tap the cover to open');
  const stage = h('div.book-stage', scroller, hint);

  const prevBtn = h('button.ctl', { type: 'button', 'aria-label': 'Previous page', onclick: () => step(-1) }, icon('left', 22));
  const nextBtn = h('button.ctl', { type: 'button', 'aria-label': 'Next page', onclick: () => step(1) }, icon('right', 22));
  const dateBtn = h('button.ctl.date-label', { type: 'button', 'aria-label': 'Jump to a date', onclick: () => openJump() });
  const todayBtn = h('button.ctl.today-btn', { type: 'button', title: 'Go to today', onclick: () => goToday() }, icon('today', 18), h('span', 'Today'));
  const closeBtn = h('button.ctl.close-btn', { type: 'button', title: 'Close the book', onclick: () => goTo(-1) }, icon('closed', 18), h('span', 'Close'));
  const strip = createStrip();
  const controls = h('div.book-controls',
    h('div.ctl-nav', closeBtn, prevBtn, dateBtn, nextBtn, todayBtn),
    strip.el);
  const el = h('div.view-book', stage, controls, assist.el);

  // ---- faces ----------------------------------------------------------------
  function faceEl(n, ro = false) {
    if (n == null || n === 367) return blankEl();
    if (n === -1) return coverEl();
    if (n === 0) {
      return endpaperEl({ owner: store.getSettings().owner, years: S.years, editable: !ro, onOwner: (v) => store.updateSettings({ owner: v }) });
    }
    return pageEl(n, ro);
  }

  function pageEl(n, ro) {
    const { m, d } = PAGES[n];
    const years = store.pageYears(m, d);
    const page = h('div.page' + (n % 2 ? '.right' : '.left'), { 'data-n': n, style: `--lines:${linesFor(years.length)}` },
      h('header.p-head', h('span', `${MONTHS[m].toUpperCase()} ${d}`), headWeekday(m, d, years)));
    const body = h('div.p-body');
    for (const y of years) body.append(slotEl(y, m, d, ro));
    page.append(body);
    return page;
  }

  // the weekday sits in the page header, for the newest year shown
  function headWeekday(m, d, years) {
    const y = [...years].reverse().find((yy) => d <= daysIn(yy, m));
    if (y == null) return null;
    return h('span.p-wd' + (dateKey(y, m, d) === today().key ? '.today' : ''), WEEKDAYS_SHORT[weekdayOf(y, m, d)].toUpperCase());
  }

  function slotEl(y, m, d, ro) {
    const k = dateKey(y, m, d);
    const valid = d <= daysIn(y, m);
    const isToday = valid && k === today().key;
    const text = h('div.slot-text', {
      contenteditable: !ro && valid ? 'plaintext-only' : null,
      spellcheck: 'false',
      autocapitalize: 'sentences',
      enterkeyhint: 'enter',
      'data-key': k,
      'data-ph': isToday ? 'Today — tap to write…' : null,
      'aria-label': `${MONTHS[m]} ${d}, ${y}`,
    }, valid ? store.getText(k) : '');
    return h('section.slot', { 'data-key': k, class: [isToday && 'today', !valid && 'na'].filter(Boolean).join(' ') },
      h('div.slot-scroll',
        h('div.badge', h('span.b20', '20'), h('span.byy', String(y).slice(2))),
        valid ? null : h('div.wd', 'NOT A LEAP YEAR'),
        text));
  }

  // ---- paging model ---------------------------------------------------------
  const idxOfPage = (n) => (S.mode === 'spread' ? spreadOf(n) : n < 0 ? 0 : n);
  const curIdx = () => idxOfPage(S.page);
  const maxIdx = () => (S.mode === 'spread' ? MAX_SPREAD : LAST);
  function pageOfIdx(i, prefer) {
    if (i === 0) return -1;
    if (S.mode === 'single') return i;
    const r = rightOf(i), l = leftOf(i);
    if (prefer === l || prefer === r) return prefer;
    return r <= LAST ? r : l;
  }

  // ---- static rendering -----------------------------------------------------
  const setHalf = (half, n) => {
    half.querySelectorAll('.half-content').forEach((c) => c.remove());
    half.prepend(h('div.half-content', n == null ? null : faceEl(n)));
  };
  // During a flip the page under the finger must stay in the DOM (touch events keep targeting it),
  // so the incoming page is built beneath it and the old one is just hidden.
  const swapHalf = (half, n) => {
    half.querySelectorAll('.half-content').forEach((c) => c.classList.add('gone'));
    half.prepend(h('div.half-content', n == null ? null : faceEl(n)));
  };

  function computeLines() {
    const s = store.getSettings();
    S.lh = LH[s.writing] || LH.book;
    S.lines = linesFor(S.years.length);
  }
  // ruled lines per year row: fewer years on a page means more lines each
  function linesFor(count) {
    const k = Math.max(1, count);
    return Math.max(2, Math.floor((BODY_EM - k * 0.12) / (S.lh * k)));
  }

  function applyMetrics() {
    book.style.setProperty('--lh', `${Math.max(10, Math.round((S.pw / 30) * S.lh))}px`);
    book.style.setProperty('--lines', S.lines);
  }

  function renderStatic() {
    S.years = store.bookYears();
    computeLines();
    applyMetrics();
    if (S.mode === 'spread') {
      const s = curIdx();
      setHalf(pgA, leftOf(s));
      setHalf(pgB, rightOf(s));
      book.style.setProperty('--open', s === 0 ? 0 : 1);
    } else {
      setHalf(pgA, null);
      setHalf(pgB, S.page);
      book.style.setProperty('--open', 1);
    }
    book.dataset.closed = S.page === -1 ? '1' : '0';
    el.dataset.closed = S.page === -1 ? '1' : '0';
    updateStacks();
    updateLabels();
    requestAnimationFrame(markOverflow);
    strip.draw();
    S.stale = false;
  }

  function markOverflow() {
    for (const slot of block.querySelectorAll('.pg-a .slot, .pg-b .slot')) checkOverflow(slot);
  }
  function checkOverflow(slot) {
    const sc = slot.querySelector('.slot-scroll');
    slot.classList.toggle('more', !!sc && sc.scrollHeight > sc.clientHeight + 2);
  }

  function stackShadow(n, dir, step) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push(`${(dir * i * step).toFixed(1)}px ${(i * step * 0.5).toFixed(1)}px 0 ${i % 2 ? '#d8d0bb' : '#eee8d9'}`);
    return out.join(',');
  }
  function updateStacks() {
    const step = Math.max(0.8, S.pw / 320);
    const closed = S.page === -1;
    const frac = clamp(curIdx() / (maxIdx() + 1), 0, 1);
    pgB.style.boxShadow = closed ? 'none' : stackShadow(Math.round(2 + 8 * (1 - frac)), 1, step);
    pgA.style.boxShadow = closed || S.mode === 'single' ? 'none' : stackShadow(Math.round(1 + 8 * frac), -1, step);
  }

  function updateLabels() {
    const s = curIdx();
    let label;
    if (S.page === -1) label = 'Cover';
    else if (S.mode === 'single') label = `${MONTHS[PAGES[S.page].m]} ${PAGES[S.page].d}`;
    else {
      const l = leftOf(s), r = rightOf(s);
      const a = PAGES[l >= 1 ? l : r], b = PAGES[r <= LAST ? r : l];
      label = a === b ? `${MONTHS[a.m]} ${a.d}`
        : a.m === b.m ? `${MONTHS_SHORT[a.m]} ${a.d} – ${b.d}` : `${MONTHS_SHORT[a.m]} ${a.d} – ${MONTHS_SHORT[b.m]} ${b.d}`;
    }
    dateBtn.textContent = label;
    prevBtn.disabled = s === 0;
    nextBtn.disabled = s === maxIdx();
    closeBtn.hidden = S.page === -1;
    todayBtn.hidden = false;
    strip.mark();
  }

  // ---- sizing ---------------------------------------------------------------
  function fit() {
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (!w || !hh) return;
    const s = store.getSettings();
    const padX = w < 520 ? 10 : 28, padY = w < 520 ? 8 : 18;
    const aw = w - padX * 2, ah = hh - padY * 2;
    const spreadPw = Math.min(aw / 2.14, ah / (ASPECT * 1.06), 560);
    const mode = s.pages === 'spread' ? 'spread' : s.pages === 'single' ? 'single' : spreadPw >= MIN_SPREAD_PW ? 'spread' : 'single';
    let pw;
    if (mode === 'spread') pw = spreadPw;
    else {
      const byW = Math.min(aw / 1.07, 560);
      const byH = ah / (ASPECT * 1.06);
      pw = byH >= byW * 0.84 ? Math.min(byW, byH) : byW; // shrink a little to avoid scrolling, else scroll
    }
    pw = Math.max(120, Math.floor(pw));
    const prevMode = S.mode, prevLines = S.lines;
    S.mode = mode;
    S.pw = pw;
    computeLines();
    const structural = mode !== prevMode || S.lines !== prevLines;
    book.dataset.mode = mode;
    book.style.setProperty('--pw', `${pw}px`);
    book.style.fontSize = `${pw / 30}px`;
    scroller.style.setProperty('--padx', `${padX}px`);
    scroller.style.setProperty('--pady', `${padY}px`);
    if (structural && !S.flipping && !S.editing) renderStatic();
    else { applyMetrics(); updateStacks(); strip.draw(); }
  }

  // ---- flipping engine ------------------------------------------------------
  function beginFlip(idx2, finalPage) {
    const idx = curIdx();
    if (idx2 === idx || idx2 < 0 || idx2 > maxIdx()) return null;
    const dir = idx2 > idx ? 1 : -1;
    const spread = S.mode === 'spread';
    const coverFlip = spread && (idx === 0 || idx2 === 0);
    let frontN, back;
    if (spread) {
      if (dir > 0) { frontN = rightOf(idx); swapHalf(pgB, rightOf(idx2)); back = faceEl(leftOf(idx2), true); }
      else { frontN = rightOf(idx2); swapHalf(pgA, idx2 === 0 ? null : leftOf(idx2)); back = faceEl(leftOf(idx), true); }
    } else {
      const pg = (i) => (i === 0 ? -1 : i);
      if (dir > 0) { frontN = pg(idx); swapHalf(pgB, pg(idx2)); } else { frontN = pg(idx2); }
      back = blankEl('rev');
    }
    if (coverFlip) back = h('div.cover-inside', back);
    const leaf = h('div.leaf' + (frontN === -1 ? '.is-cover' : ''),
      h('div.face.front', faceEl(frontN, true)),
      h('div.face.back', back));
    block.append(leaf);
    block.classList.add('flipping');

    const q0 = dir > 0 ? 0 : 1, q1 = dir > 0 ? 1 : 0;
    const f = {
      dir, q0, q1, q: q0, leaf,
      apply(q) {
        f.q = q;
        leaf.style.transform = `rotateY(${(-180 * q).toFixed(2)}deg)`;
        const sh = Math.sin(Math.PI * q);
        leaf.style.setProperty('--shade', (sh * 0.5).toFixed(3));
        pgB.style.setProperty('--cast', (sh * (1 - q)).toFixed(3));
        pgA.style.setProperty('--cast', (sh * q).toFixed(3));
        if (coverFlip) {
          const open = q;
          book.style.setProperty('--open', open.toFixed(3));
        }
      },
      commit() { S.page = pageOfIdx(idx2, finalPage); done(); },
      rollback() { done(); },
    };
    const done = () => {
      leaf.remove();
      S.flipping = null;
      block.classList.remove('flipping');
      pgA.style.removeProperty('--cast');
      pgB.style.removeProperty('--cast');
      renderStatic();
    };
    S.flipping = f;
    f.apply(q0);
    return f;
  }

  function run(f, to, ms) {
    if (reduceMotion()) ms = 0;
    return new Promise((resolve) => {
      const from = f.q;
      if (from === to || ms <= 0) { f.apply(to); return resolve(); }
      const t0 = performance.now();
      const frame = (now) => {
        const t = clamp((now - t0) / ms, 0, 1);
        f.apply(from + (to - from) * ease(t));
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function flipTo(idx2, finalPage, ms = 700) {
    const f = beginFlip(idx2, finalPage);
    if (!f) return false;
    await run(f, f.q1, ms);
    f.commit();
    return true;
  }

  function blurEditing() { if (document.activeElement?.closest?.('.slot-text, .owner-name')) document.activeElement.blur(); }

  async function goTo(page, { focusKey } = {}) {
    if (S.busy) return;
    S.busy = true;
    try {
      blurEditing();
      const target = idxOfPage(page);
      if (curIdx() === 0 && target > 0) await flipTo(1, target === 1 ? page : undefined, 780);
      const dest = target === 0 ? 1 : target;
      const cur = curIdx();
      if (cur !== dest && cur !== 0) {
        const d = dest - cur;
        const steps = Math.min(Math.abs(d), 6);
        for (let i = 1; i <= steps; i++) {
          const last = i === steps;
          const idx2 = last ? dest : cur + Math.round((d * i) / steps);
          await flipTo(idx2, last ? page : undefined, steps === 1 ? 720 : last ? 560 : 230);
        }
      }
      if (target === 0 && curIdx() !== 0) await flipTo(0, -1, 780);
      if (page > 0 && S.page !== page && idxOfPage(page) === curIdx()) { S.page = page; }
    } finally {
      S.busy = false;
    }
    if (focusKey) pulse(focusKey);
  }

  const step = (dir) => {
    if (S.busy) return;
    const i = curIdx() + dir;
    if (i < 0 || i > maxIdx()) return;
    blurEditing();
    S.busy = true;
    flipTo(i, undefined, 640).finally(() => { S.busy = false; });
  };

  function goToday() { const t = today(); return goTo(t.n, { focusKey: t.key }); }
  function goToKey(k) { const { m, d } = parseKey(k); return goTo(pageOf(m, d), { focusKey: k }); }
  const openBook = () => goToday();

  function pulse(k) {
    const slot = block.querySelector(`.pg-a .slot[data-key="${k}"], .pg-b .slot[data-key="${k}"]`);
    if (!slot) return;
    slot.classList.remove('pulse');
    void slot.offsetWidth;
    slot.classList.add('pulse');
    setTimeout(() => slot.classList.remove('pulse'), 2400);
    const sr = scroller.getBoundingClientRect(), r = slot.getBoundingClientRect();
    if (r.top < sr.top || r.bottom > sr.bottom) scroller.scrollBy({ top: r.top - sr.top - sr.height / 3, behavior: 'smooth' });
  }

  // ---- gestures: drag to turn, tap edges, wheel ------------------------------
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (S.busy || S.editing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('button, input, .book-hint')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType, onText: !!e.target.closest('.slot-text, .owner-name'), f: null, last: [] };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.f) {
      if (drag.type === 'mouse' && drag.onText) return; // let the mouse select text
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) {
        if (Math.abs(dy) > 14 && drag.type !== 'mouse') drag = null;
        return;
      }
      const dir = dx < 0 ? 1 : -1;
      // capture first: beginFlip swaps the page under the finger, which would otherwise end the touch stream
      try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const f = beginFlip(curIdx() + dir);
      if (!f) { try { stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ } drag = null; return; }
      drag.f = f;
      drag.x0 = e.clientX;
      getSelection()?.removeAllRanges();
      blurEditing();
    }
    const f = drag.f;
    const span = S.pw * (S.mode === 'spread' ? 0.95 : 0.85);
    const signed = (e.clientX - drag.x0) * (f.dir > 0 ? -1 : 1);
    const prog = clamp(signed / span, 0, 1);
    f.apply(f.dir > 0 ? prog : 1 - prog);
    drag.last.push([performance.now(), e.clientX]);
    if (drag.last.length > 5) drag.last.shift();
  });
  const endDrag = async (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.f) {
      const f = d.f;
      const prog = f.dir > 0 ? f.q : 1 - f.q;
      let vel = 0;
      if (d.last.length > 1) {
        const [ta, xa] = d.last[0], [tb, xb] = d.last.at(-1);
        vel = ((xb - xa) / Math.max(1, tb - ta)) * (f.dir > 0 ? -1 : 1); // px/ms toward completing
      }
      const complete = !cancelled && (prog > 0.35 || vel > 0.45) && vel > -0.45;
      S.busy = true;
      const remaining = Math.abs((complete ? f.q1 : f.q0) - f.q);
      await run(f, complete ? f.q1 : f.q0, 120 + remaining * 520);
      complete ? f.commit() : f.rollback();
      S.busy = false;
      return;
    }
    // a tap
    const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (cancelled || moved > 8 || performance.now() - d.t0 > 500) return;
    if (S.page === -1) return openBook();
    if (e.target.closest('.slot-text, .owner-name')) return;
    const page = e.target.closest('.page');
    if (!page) return;
    const r = page.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    const isLeft = page.closest('.pg-a') != null;
    if (S.mode === 'spread') { if (isLeft && rel < 0.1) step(-1); else if (!isLeft && rel > 0.9) step(1); }
    else if (rel < 0.08) step(-1); else if (rel > 0.92) step(1);
  };
  stage.addEventListener('pointerup', (e) => endDrag(e, false));
  stage.addEventListener('pointercancel', (e) => endDrag(e, true));

  let wheelAcc = 0, wheelAt = 0;
  stage.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || S.editing) return;
    const now = performance.now();
    if (now - wheelAt > 250) wheelAcc = 0;
    wheelAt = now;
    wheelAcc += e.deltaX;
    if (Math.abs(wheelAcc) > 90 && !S.busy) { step(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; wheelAt = now + 500; }
  }, { passive: true });

  // ---- editing --------------------------------------------------------------
  const labelFor = (k) => { const { y, m, d } = parseKey(k); return `${WEEKDAYS_SHORT[weekdayOf(y, m, d)]}, ${MONTHS_SHORT[m]} ${d}, ${y}`; };
  function adapter(t) {
    const k = t.dataset.key;
    return {
      key: k,
      label: labelFor(k),
      get: () => store.normalize(t.innerText),
      set(text, { raw } = {}) {
        t.textContent = text;
        store.setText(k, text, raw === undefined ? {} : { raw });
        checkOverflow(t.closest('.slot'));
        const rng = document.createRange();
        rng.selectNodeContents(t);
        rng.collapse(false);
        const sel = getSelection();
        if (document.activeElement === t) { sel.removeAllRanges(); sel.addRange(rng); }
      },
    };
  }

  block.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('.slot-text');
    if (!t) return;
    S.editing = t.dataset.key;
    el.classList.add('editing');
    assist.setTarget(adapter(t));
    setTimeout(revealEditing, 260);
    updateKeyboard();
    setTimeout(updateKeyboard, 350);
  });
  block.addEventListener('focusout', (e) => {
    const t = e.target.closest?.('.slot-text');
    if (!t) return;
    setTimeout(() => {
      if (document.activeElement?.closest?.('.slot-text')) return;
      if (assist.recording) { t.focus({ preventScroll: true }); return; }
      endEditing(t);
    }, 0);
  });
  block.addEventListener('input', (e) => {
    const t = e.target.closest?.('.slot-text');
    if (!t) return;
    store.setText(t.dataset.key, t.innerText);
    checkOverflow(t.closest('.slot'));
    assist.refresh();
    revealEditing();
  });
  block.addEventListener('paste', (e) => {
    if (!e.target.closest?.('.slot-text')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  block.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur?.(); });

  function endEditing(t) {
    S.editing = null;
    el.classList.remove('editing');
    for (const v of ['--kb', '--vvh', '--vvt']) document.documentElement.style.removeProperty(v);
    // iOS can leave the page panned or the viewport short after the keyboard closes.
    window.scrollTo(0, 0);
    setTimeout(() => window.scrollTo(0, 0), 300);
    assist.setTarget(null);
    if (!store.getText(t.dataset.key) && t.textContent) t.textContent = '';
    store.flush();
    if (S.stale) renderStatic(); else strip.draw();
  }

  function revealEditing() {
    const t = block.querySelector('.slot-text:focus');
    if (!t) return;
    const vv = window.visualViewport;
    const sr = scroller.getBoundingClientRect();
    const pad = 16;
    const visTop = Math.max(sr.top, vv?.offsetTop || 0) + pad;
    const visBottom = Math.min(sr.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - (assist.el.offsetHeight || 60) - pad;
    // A slot can be a whole page tall, so follow the caret, not the slot.
    let r = null;
    const sel = getSelection();
    if (sel?.rangeCount && t.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);
      const rects = range.getClientRects();
      r = rects[rects.length - 1] || range.getBoundingClientRect();
    }
    if (!r || !r.height) {
      const tr = t.getBoundingClientRect();
      r = { top: tr.top, bottom: tr.top + (parseFloat(getComputedStyle(t).lineHeight) || 24) };
    }
    let delta = 0;
    if (r.bottom + scroller.scrollTop <= visBottom) delta = -scroller.scrollTop; // fits with the page top showing
    else if (r.bottom > visBottom) delta = r.bottom - visBottom;
    else if (r.top < visTop) delta = r.top - visTop;
    if (Math.abs(delta) > 4) scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }

  function updateKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    const root = document.documentElement.style;
    root.setProperty('--kb', `${Math.round(kb)}px`);
    if (S.editing || kb > 80) { root.setProperty('--vvh', `${Math.round(vv.height)}px`); root.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`); }
    else { root.removeProperty('--vvh'); root.removeProperty('--vvt'); }
    if (S.editing) setTimeout(revealEditing, 60);
  }
  window.visualViewport?.addEventListener('resize', updateKeyboard);
  window.visualViewport?.addEventListener('scroll', updateKeyboard);

  // ---- jump-to-date sheet ---------------------------------------------------
  function openJump() {
    if (S.busy) return;
    let m = S.page > 0 ? PAGES[S.page].m : today().m;
    const dlg = h('dialog.sheet.small.jump');
    const render = () => {
      const filled = store.filledPerPage();
      const t = today();
      const days = PAGES.filter((p) => p && p.m === m);
      dlg.replaceChildren(h('div.sheet-body',
        h('div.jump-months', MONTHS_SHORT.map((name, i) => h('button.chip' + (i === m ? '.on' : ''), { type: 'button', onclick: () => { m = i; render(); } }, name))),
        h('div.jump-days', days.map((p) => h('button.day' + (filled[p.n] ? '.has' : '') + (t.n === p.n ? '.is-today' : ''), {
          type: 'button',
          onclick: () => { dlg.close(); goTo(p.n, { focusKey: dateKey(t.y, p.m, p.d) }); },
        }, p.d))),
        h('div.row.end',
          h('button.btn.ghost', { type: 'button', onclick: () => { dlg.close(); goToday(); } }, icon('today', 18), 'Today'),
          h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Close'))));
    };
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    render();
    dlg.showModal();
  }

  // ---- position strip (doubles as a "where have I written?" map) ---------------
  function createStrip() {
    const canvas = h('canvas.strip-canvas');
    const marker = h('div.strip-marker');
    const tip = h('div.strip-tip');
    const months = h('div.strip-months');
    const wrap = h('div.strip', { role: 'slider', 'aria-label': 'Position in the book', 'aria-valuemin': 1, 'aria-valuemax': LAST }, canvas, marker, tip, months);
    let dragging = false;
    const pageAtX = (clientX) => {
      const r = wrap.getBoundingClientRect();
      return clamp(Math.floor(((clientX - r.left) / r.width) * LAST) + 1, 1, LAST);
    };
    const showTip = (n, clientX) => {
      const r = wrap.getBoundingClientRect();
      tip.textContent = `${MONTHS_SHORT[PAGES[n].m]} ${PAGES[n].d}`;
      tip.style.left = `${clamp(clientX - r.left, 24, r.width - 24)}px`;
      tip.classList.add('on');
      marker.style.left = `${((n - 0.5) / LAST) * 100}%`;
      marker.style.width = '4px';
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (S.busy) return;
      dragging = true;
      wrap.setPointerCapture(e.pointerId);
      showTip(pageAtX(e.clientX), e.clientX);
    });
    wrap.addEventListener('pointermove', (e) => { if (dragging) showTip(pageAtX(e.clientX), e.clientX); });
    const release = (e, cancel) => {
      if (!dragging) return;
      dragging = false;
      tip.classList.remove('on');
      if (cancel) return mark();
      const n = pageAtX(e.clientX);
      const t = today();
      goTo(n, { focusKey: n === t.n ? t.key : undefined });
    };
    wrap.addEventListener('pointerup', (e) => release(e, false));
    wrap.addEventListener('pointercancel', (e) => release(e, true));

    function draw() {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      if (!W) return;
      const dpr = Math.min(devicePixelRatio || 1, 3);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const g = canvas.getContext('2d');
      g.scale(dpr, dpr);
      g.clearRect(0, 0, W, H);
      const per = store.filledPerPage();
      const bw = W / LAST;
      const t = today();
      for (let n = 1; n <= LAST; n++) {
        const c = per[n];
        g.fillStyle = c ? `rgba(232, 197, 108, ${0.45 + Math.min(c, 5) * 0.11})` : 'rgba(255, 255, 255, 0.13)';
        g.fillRect((n - 1) * bw + 0.25, 4, Math.max(0.8, bw - 0.5), H - 8);
      }
      g.fillStyle = '#fff';
      g.fillRect((t.n - 1) * bw - 0.5, 0, Math.max(2, bw + 1), 4);
      // month labels
      months.replaceChildren();
      const narrow = W < 460;
      for (let mo = 0; mo < 12; mo++) {
        const start = pageOf(mo, 1);
        months.append(h('span', { style: { left: `${((start - 1) / LAST) * 100}%` } }, narrow ? MONTHS[mo][0] : MONTHS_SHORT[mo]));
      }
      mark();
    }
    function mark() {
      const n = S.page === -1 ? 1 : S.page;
      const wide = S.mode === 'spread' && S.page !== -1 ? 2 : 1;
      const l = S.mode === 'spread' && S.page !== -1 ? clamp(leftOf(spreadOf(S.page)) || 1, 1, LAST) : n;
      marker.style.left = `${((l - 1) / LAST) * 100}%`;
      marker.style.width = `max(5px, ${(wide / LAST) * 100}%)`;
      wrap.setAttribute('aria-valuenow', n);
    }
    return { el: wrap, draw, mark };
  }

  // ---- lifecycle ------------------------------------------------------------
  new ResizeObserver(debounce(fit, 40)).observe(stage);
  const drawStripSoon = debounce(() => strip.draw(), 400);
  store.onChange((k) => {
    if (k && k === S.editing) { drawStripSoon(); return; } // our own typing: the page already shows it
    S.stale = true;
    if (S.editing || S.flipping || el.offsetParent === null) { drawStripSoon(); return; }
    renderStatic();
  });
  store.onSettings(() => { if (!S.flipping && !S.editing) { fit(); renderStatic(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.day !== today().key) { S.day = today().key; if (!S.editing && !S.flipping) renderStatic(); }
  });

  S.page = store.getSettings().skipCover ? today().n : -1;
  requestAnimationFrame(fit);

  return {
    el,
    refresh() { fit(); if (S.stale || !block.querySelector('.page')) renderStatic(); else strip.draw(); },
    /** Show a page without animating (used by the 3D book's write view). Optionally focus a line. */
    jumpTo(page, focusKey) {
      S.page = page;
      fit();
      renderStatic();
      if (focusKey) {
        const t = block.querySelector(`.slot-text[data-key="${focusKey}"]`);
        if (t && t.isContentEditable) {
          t.focus({ preventScroll: true });
          const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        }
        pulse(focusKey);
      }
    },
    get page() { return S.page; },
    goTo, goToday, goToKey, openBook,
    get isOpen() { return S.page !== -1; },
    get editing() { return !!S.editing; },
    handleKey(e) {
      if (S.editing || S.busy) return false;
      if (e.key === 'ArrowRight') { step(1); return true; }
      if (e.key === 'ArrowLeft') { step(-1); return true; }
      if (e.key === 't' || e.key === 'T') { goToday(); return true; }
      return false;
    },
  };
}

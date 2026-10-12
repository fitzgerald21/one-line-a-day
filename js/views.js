// Journal (timeline), Calendar and Progress views — the "regular journaling app" side.
import { h, icon, plural, downloadFile } from './ui.js';
import * as store from './store.js';
import { MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, today, dateKey, daysIn, weekdayOf, parseKey, longDate, pageOf, validDate } from './dates.js';

const snippet = (t, n = 160) => (t.length > n ? t.slice(0, n).trimEnd() + '…' : t);

// =============================================================================
// Journal
// =============================================================================
export function createJournal({ openEditor }) {
  let query = '';
  let year = 'all';
  let shown = 80;

  const search = h('input.search', { type: 'search', placeholder: 'Search your entries…', 'aria-label': 'Search entries', oninput: (e) => { query = e.target.value.trim().toLowerCase(); shown = 80; render(); } });
  const yearSel = h('select', { 'aria-label': 'Year', onchange: (e) => { year = e.target.value; shown = 80; render(); } });
  const hero = h('div.j-hero');
  const list = h('div.j-list');
  const el = h('div.view-scroll.journal', h('div.paper',
    h('div.j-tools', h('label.search-wrap', icon('search', 18), search), yearSel),
    hero, list));

  function renderHero() {
    const t = today();
    hero.replaceChildren();
    if (query) return;
    const hidden = store.hiddenEntryKeys();
    if (hidden.length) {
      const hy = [...new Set(hidden.map((k) => +k.slice(0, 4)))];
      hero.append(h('section.notice-card',
        h('b', `${plural(hidden.length, 'entry').replace('entrys', 'entries')} from ${hy.join(', ')} ${hidden.length === 1 ? 'isn’t' : 'aren’t'} showing in the book`),
        h('p', 'The book holds five years in a row, so entries outside that window stay hidden there. If one has a misread year, open it and use “Wrong date? Move this entry”.'),
        h('button.btn.small', { type: 'button', onclick: () => { year = String(hy[0]); shown = 80; render(); } }, `Show ${hy[0]}`)));
    }
    const text = store.getText(t.key);
    const memories = store.entryYears().filter((y) => y < t.y && store.hasEntry(dateKey(y, t.m, t.d)));
    hero.append(h('section.hero-card',
      h('div.hero-kicker', `Today · ${longDate(t.key)}`),
      text
        ? h('p.hero-text', text)
        : h('p.hero-text.empty', 'Nothing written yet. What was today like?'),
      h('button.btn.primary', { type: 'button', onclick: () => openEditor(t.key) }, text ? 'Edit today’s line' : 'Write today’s line')));
    for (const y of memories.reverse()) {
      const k = dateKey(y, t.m, t.d);
      hero.append(h('section.memory-card', { onclick: () => openEditor(k) },
        h('div.hero-kicker', `On this day · ${t.y - y} ${t.y - y === 1 ? 'year' : 'years'} ago`),
        h('p.hero-text', snippet(store.getText(k), 220))));
    }
  }

  function render() {
    const ys = store.entryYears();
    const keepYear = year;
    yearSel.replaceChildren(h('option', { value: 'all' }, 'All years'), ...[...ys].reverse().map((y) => h('option', { value: y }, y)));
    yearSel.value = ys.includes(+keepYear) ? keepYear : 'all';
    year = yearSel.value;
    renderHero();

    let keys = store.sortedKeys().slice().reverse();
    if (year !== 'all') keys = keys.filter((k) => k.startsWith(year));
    if (query) keys = keys.filter((k) => store.getText(k).toLowerCase().includes(query));
    list.replaceChildren();
    if (!keys.length) {
      list.append(h('div.empty-state',
        h('div.empty-art', icon('book', 40)),
        h('p', query ? 'No entries match your search.' : 'Your journal is empty — write today’s line to get started.')));
      return;
    }
    let group = '';
    let section;
    for (const k of keys.slice(0, shown)) {
      const { y, m, d } = parseKey(k);
      const g = `${MONTHS[m]} ${y}`;
      if (g !== group) {
        group = g;
        section = h('section.j-group', h('h3.j-month', g));
        list.append(section);
      }
      section.append(h('article.j-card', { tabindex: 0, role: 'button', onclick: () => openEditor(k), onkeydown: (e) => { if (e.key === 'Enter') openEditor(k); } },
        h('div.j-date', h('div.j-dow', WEEKDAYS_SHORT[weekdayOf(y, m, d)]), h('div.j-day', d)),
        h('p.j-text', store.getText(k))));
    }
    if (keys.length > shown) {
      list.append(h('button.btn.ghost.more', { type: 'button', onclick: () => { shown += 120; render(); } }, `Show more (${keys.length - shown} left)`));
    }
    list.append(h('div.j-count', plural(keys.length, 'entry').replace('entrys', 'entries')));
  }

  return { el, refresh: render, showYear(y) { year = String(y); shown = 80; query = ''; search.value = ''; render(); } };
}

// =============================================================================
// Calendar
// =============================================================================
export function createCalendar({ openEditor, openInBook }) {
  const t0 = today();
  let y = t0.y, m = t0.m, sel = t0.key;

  const monthSel = h('select', { 'aria-label': 'Month', onchange: (e) => { m = +e.target.value; render(); } }, MONTHS.map((n, i) => h('option', { value: i }, n)));
  const yearSel = h('select', { 'aria-label': 'Year', onchange: (e) => { y = +e.target.value; render(); } });
  const grid = h('div.cal-grid');
  const panel = h('section.cal-panel');
  const go = (dm) => { m += dm; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } render(); };
  const head = h('div.cal-head',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Previous month', onclick: () => go(-1) }, icon('left')),
    h('div.cal-title', monthSel, yearSel),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Next month', onclick: () => go(1) }, icon('right')),
    h('button.btn.small', { type: 'button', onclick: () => { const t = today(); y = t.y; m = t.m; sel = t.key; render(); } }, 'Today'));
  const el = h('div.view-scroll.calendar', h('div.paper', head, grid, panel));

  function render() {
    const ys = store.entryYears();
    const lo = Math.min(ys[0] ?? t0.y, t0.y, y), hi = Math.max(t0.y + 1, ys.at(-1) ?? t0.y, y);
    yearSel.replaceChildren(...Array.from({ length: hi - lo + 1 }, (_, i) => h('option', { value: lo + i }, lo + i)));
    yearSel.value = y;
    monthSel.value = m;
    const today_ = today();
    grid.replaceChildren(...WEEKDAYS_SHORT.map((d) => h('div.cal-dow', d[0] + d[1])));
    const first = new Date(y, m, 1).getDay();
    for (let i = 0; i < first; i++) grid.append(h('div.cal-cell.blank'));
    for (let d = 1; d <= daysIn(y, m); d++) {
      const k = dateKey(y, m, d);
      const text = store.getText(k);
      grid.append(h('button.cal-cell' + (text ? '.has' : '') + (k === today_.key ? '.today' : '') + (k === sel ? '.sel' : ''),
        { type: 'button', 'aria-label': longDate(k) + (text ? ', has an entry' : ''), onclick: () => { sel = k; render(); } },
        h('span.cal-num', d),
        text && h('span.cal-snip', snippet(text, 46)),
        text && h('span.cal-dot')));
    }
    renderPanel();
  }

  function renderPanel() {
    const { m: sm, d: sd } = parseKey(sel);
    const text = store.getText(sel);
    const others = store.entryYears().filter((yy) => yy !== parseKey(sel).y && store.hasEntry(dateKey(yy, sm, sd)));
    panel.replaceChildren(
      h('h3', longDate(sel)),
      text ? h('p.cal-text', text) : h('p.cal-text.empty', 'Nothing written for this day.'),
      h('div.row',
        h('button.btn.primary', { type: 'button', onclick: () => openEditor(sel) }, text ? 'Edit' : 'Write'),
        h('button.btn', { type: 'button', onclick: () => openInBook(sel) }, icon('book', 18), 'Open in book')),
      others.length > 0 && h('div.cal-others', h('h4', 'Same day, other years'),
        others.map((yy) => { const k = dateKey(yy, sm, sd); return h('p', { onclick: () => openEditor(k) }, h('b', yy), ' ', snippet(store.getText(k), 140)); })));
  }

  return { el, refresh: render, select(k) { sel = k; const p = parseKey(k); y = p.y; m = p.m; render(); } };
}

// =============================================================================
// Progress
// =============================================================================
export function createProgress({ openEditor, openInBook }) {
  let year = today().y;
  const stats = h('div.stat-row');
  const tabs = h('div.year-tabs');
  const summary = h('div.year-summary');
  const grid = h('div.year-grid');
  const legend = h('div.legend',
    h('span', h('i.sw.filled'), 'Written'), h('span', h('i.sw.missed'), 'Skipped'), h('span', h('i.sw.future'), 'Still to come'));
  const catchup = h('div.catchup');
  const mapGrid = h('div.year-grid.map');
  const backup = h('div.backup-card');
  const el = h('div.view-scroll.progress', h('div.paper',
    stats, backup,
    h('h3.sec', 'Year by year'), tabs, summary, grid, legend, catchup,
    h('h3.sec', 'Across the whole book'),
    h('p.muted', 'Every page of the book, darker where more years are filled in.'),
    mapGrid));

  function statCard(icn, value, label) {
    return h('div.stat', h('div.stat-icn', icon(icn, 20)), h('div.stat-val', value), h('div.stat-lbl', label));
  }

  function buildGrid(target, cellFn) {
    target.replaceChildren(h('div.yg-corner'), ...MONTHS_SHORT.map((n) => h('div.yg-mh', n[0], h('span', n.slice(1)))));
    for (let d = 1; d <= 31; d++) {
      target.append(h('div.yg-dh', d));
      for (let m = 0; m < 12; m++) target.append(cellFn(m, d));
    }
  }

  function render() {
    const st = store.stats();
    stats.replaceChildren(
      statCard('flame', st.current, `day streak`),
      statCard('chart', st.longest, 'longest streak'),
      statCard('book', st.total.toLocaleString(), 'entries'),
      statCard('list', st.words.toLocaleString(), 'words'));

    // backup nudge
    const lastB = store.getSettings().lastBackup;
    const stale = !lastB || Date.now() - lastB > 30 * 86400000;
    backup.replaceChildren();
    if (st.total >= 5 && stale) {
      backup.append(
        h('div', h('b', 'Back up your journal'), h('p', lastB ? 'It has been a while since your last backup.' : 'Your entries live only in this browser — a backup file keeps them safe.')),
        h('button.btn.primary', { type: 'button', onclick: () => { downloadFile(`one-line-a-day-${today().key}.json`, store.exportData()); store.markBackup(); render(); } }, icon('download', 18), 'Download backup'));
    }
    backup.hidden = !backup.childNodes.length;

    const t = today();
    const years = [...new Set([...store.entryYears(), t.y])].sort((a, b) => a - b);
    if (!years.includes(year)) year = t.y;
    tabs.replaceChildren(...years.map((yy) => h('button.chip' + (yy === year ? '.on' : ''), { type: 'button', onclick: () => { year = yy; render(); } }, yy)));

    // per-year numbers
    let possible = 0, filled = 0;
    const missed = [];
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= daysIn(year, m); d++) {
        const k = dateKey(year, m, d);
        if (k > t.key) continue;
        possible++;
        if (store.hasEntry(k)) filled++; else missed.push(k);
      }
    }
    const pct = possible ? Math.round((filled / possible) * 100) : 0;
    summary.replaceChildren(
      h('div.bar', h('i', { style: { width: `${pct}%` } })),
      h('p', h('b', `${filled}`), ` of ${possible} days written in ${year} · ${pct}%`));

    buildGrid(grid, (m, d) => {
      if (!validDate(year, m, d)) return h('div.yg-cell.na');
      const k = dateKey(year, m, d);
      const state = store.hasEntry(k) ? 'filled' : k > t.key ? 'future' : 'missed';
      return h('button.yg-cell.' + state + (k === t.key ? '.today' : ''), {
        type: 'button', title: longDate(k), 'aria-label': `${longDate(k)}: ${state}`, onclick: () => openEditor(k),
      });
    });

    catchup.replaceChildren();
    if (missed.length) {
      const recent = missed.slice(-8).reverse();
      catchup.append(h('h4', 'Catch up'), h('div.chips', recent.map((k) => {
        const { m, d } = parseKey(k);
        return h('button.chip', { type: 'button', onclick: () => openEditor(k) }, `${MONTHS_SHORT[m]} ${d}`);
      })));
    }

    const per = store.filledPerPage();
    const years5 = Math.max(1, store.bookYears().length);
    buildGrid(mapGrid, (m, d) => {
      const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
      if (d > dim) return h('div.yg-cell.na');
      const n = pageOf(m, d);
      const c = per[n];
      const level = c ? Math.min(5, Math.ceil((c / years5) * 5)) : 0;
      return h('button.yg-cell.lvl' + level, {
        type: 'button', title: `${MONTHS[m]} ${d}: ${c} ${c === 1 ? 'year' : 'years'} written`, 'aria-label': `${MONTHS[m]} ${d}`,
        onclick: () => openInBook(dateKey(today().y, m, d)),
      });
    });
  }

  return { el, refresh: render };
}

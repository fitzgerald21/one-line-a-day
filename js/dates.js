// Calendar helpers. A "page" is a month/day (1..366, leap day included) — exactly
// like the pages of a One Line a Day book. Months are 0-based everywhere.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = WEEKDAYS.map((d) => d.slice(0, 3));

const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const LAST = 366;

/** PAGES[n] = {n, m, d} for n in 1..366 (index 0 unused). */
export const PAGES = [null];
const OFFSET = [];
{
  let n = 0;
  for (let m = 0; m < 12; m++) {
    OFFSET[m] = n;
    for (let d = 1; d <= DIM[m]; d++) PAGES.push({ n: ++n, m, d });
  }
}

const pad = (v, l = 2) => String(v).padStart(l, '0');

export const pageOf = (m, d) => OFFSET[m] + d;
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysIn = (y, m) => (m === 1 ? (isLeap(y) ? 29 : 28) : DIM[m]);
export const validDate = (y, m, d) => m >= 0 && m < 12 && d >= 1 && d <= daysIn(y, m);
export const dateKey = (y, m, d) => `${pad(y, 4)}-${pad(m + 1)}-${pad(d)}`;

export function parseKey(k) {
  const [y, mo, d] = k.split('-').map(Number);
  return { y, m: mo - 1, d };
}
export const pageOfKey = (k) => {
  const { m, d } = parseKey(k);
  return pageOf(m, d);
};
export const weekdayOf = (y, m, d) => new Date(y, m, d).getDay();

export function today() {
  const t = new Date();
  const y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
  return { y, m, d, key: dateKey(y, m, d), n: pageOf(m, d) };
}

export function longDate(k) {
  const { y, m, d } = parseKey(k);
  return `${WEEKDAYS[weekdayOf(y, m, d)]}, ${MONTHS[m]} ${d}, ${y}`;
}
export function shortDate(k) {
  const { y, m, d } = parseKey(k);
  return `${WEEKDAYS_SHORT[weekdayOf(y, m, d)]}, ${MONTHS_SHORT[m]} ${d}, ${y}`;
}

/** Key for the day before/after a key (used by editor prev/next). */
export function shiftKey(k, delta) {
  const { y, m, d } = parseKey(k);
  const t = new Date(y, m, d + delta);
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

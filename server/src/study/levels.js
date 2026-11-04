// Day levels worked out from yesterday's high, low and close, the way Indian intraday traders draw them each morning:
// the floor pivot and its CPR (central pivot range), R1/S1 and R2/S2, the Camarilla H3/H4/L3/L4, and yesterday's value area
// (where the index spent 70% of its time, a market-profile reading that needs no volume, so it works for the index).
// Every number on a bar uses only finished days, never today's bars, so nothing looks ahead.

const VALUE_SHARE = 0.7; // the value area holds 70% of the day's time at price
const BINS = 40; // yesterday's range is cut into this many price steps for the time-at-price count

/**
 * Where yesterday spent its time: { poc, vah, val }. Each 5-minute bar adds one count to every price step it covered.
 * The point of control is the busiest step; the value area grows from it, taking the busier neighbour each time, until it holds 70%.
 */
export function valueArea(dayBars) {
  if (!dayBars.length) return null;
  const hi = Math.max(...dayBars.map((b) => b.high));
  const lo = Math.min(...dayBars.map((b) => b.low));
  if (!(hi > lo)) return { poc: hi, vah: hi, val: lo };
  const step = (hi - lo) / BINS;
  const counts = new Array(BINS).fill(0);
  const binOf = (p) => Math.min(BINS - 1, Math.max(0, Math.floor((p - lo) / step)));
  for (const b of dayBars) for (let k = binOf(b.low); k <= binOf(b.high); k++) counts[k] += 1;
  const total = counts.reduce((s, x) => s + x, 0);
  // busiest step; on a tie the one nearest the middle of the range
  let poc = 0;
  for (let k = 1; k < BINS; k++) if (counts[k] > counts[poc] || (counts[k] === counts[poc] && Math.abs(k - (BINS - 1) / 2) < Math.abs(poc - (BINS - 1) / 2))) poc = k;
  let top = poc;
  let bottom = poc;
  let held = counts[poc];
  while (held < VALUE_SHARE * total && (top < BINS - 1 || bottom > 0)) {
    const up = top < BINS - 1 ? counts[top + 1] : -1;
    const down = bottom > 0 ? counts[bottom - 1] : -1;
    if (up >= down) held += counts[++top];
    else held += counts[--bottom];
  }
  return { poc: lo + (poc + 0.5) * step, vah: lo + (top + 1) * step, val: lo + bottom * step };
}

/** The levels of one day, from the day before's high, low and close (and its bars, for the value area). */
export function levelsFrom(h, l, c, dayBars = null) {
  const pp = (h + l + c) / 3;
  const bc = (h + l) / 2;
  const tc = 2 * pp - bc;
  const r = h - l;
  const va = dayBars ? valueArea(dayBars) : null;
  return {
    h,
    l,
    c,
    pp,
    cprTop: Math.max(tc, bc),
    cprBottom: Math.min(tc, bc),
    cprWidth: Math.abs(tc - bc),
    r1: 2 * pp - l,
    s1: 2 * pp - h,
    r2: pp + r,
    s2: pp - r,
    h3: c + (1.1 * r) / 4,
    l3: c - (1.1 * r) / 4,
    h4: c + (1.1 * r) / 2,
    l4: c - (1.1 * r) / 2,
    poc: va?.poc ?? null,
    vah: va?.vah ?? null,
    val: va?.val ?? null,
  };
}

/**
 * For every bar, the levels of its day (null on the first day of the data, which has no yesterday), plus
 * `prev` (the day before's own levels, to see whether the CPR moved up) and `widthAvg` (the average CPR width of the 5 days before).
 * `dayStart[i]` is the index of the first bar of bar i's day. Works on a mirrored chart too (prices negated): the levels come out mirrored.
 */
export function dayLevels(bars, dayStart) {
  const starts = [...new Set(dayStart)];
  const perDay = new Map(); // first bar index of a day -> its levels
  const widths = [];
  for (let n = 1; n < starts.length; n++) {
    const from = starts[n - 1];
    const to = starts[n] - 1;
    const day = bars.slice(from, to + 1);
    const lv = levelsFrom(Math.max(...day.map((b) => b.high)), Math.min(...day.map((b) => b.low)), day.at(-1).close, day);
    const past = widths.slice(-5);
    lv.widthAvg = past.length >= 5 ? past.reduce((s, x) => s + x, 0) / past.length : null;
    lv.prev = perDay.get(starts[n - 1]) || null;
    lv.dayOpen = bars[starts[n]].open;
    widths.push(lv.cprWidth);
    perDay.set(starts[n], lv);
  }
  return bars.map((_, i) => perDay.get(dayStart[i]) || null);
}

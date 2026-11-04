import test from 'node:test';
import assert from 'node:assert/strict';
import { levelsFrom, valueArea, dayLevels } from '../src/study/levels.js';
import { prepare, findSignals, TECHNIQUES } from '../src/study/patterns.js';
import { buildChart, holds, CONDITION_BY_KEY, GROUPS } from '../src/combos/conditions.js';

// Monday 12 Oct 2026, 09:15 IST
const OPEN = Date.UTC(2026, 9, 12, 3, 45) / 1000;
const DAY = 86400;
const bar = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 0 });
const mirror = (bars) => bars.map((b) => ({ ...b, open: 48000 - b.open, high: 48000 - b.low, low: 48000 - b.high, close: 48000 - b.close }));

/** Yesterday: 75 bars between 24000 and 24100 closing at 24050 (pivot 24050, CPR 24050, R1 24100, H4 24105). Today: given closes. */
function twoDays(todayCloses) {
  const y = Array.from({ length: 75 }, (_, k) => {
    const c = 24050 + (k % 2 ? 10 : -10);
    return bar(OPEN + k * 300, c, c + 5, c - 5, c);
  });
  y[10] = { ...y[10], high: 24100 };
  y[20] = { ...y[20], low: 24000 };
  y[74] = { ...y[74], close: 24050 };
  const t = todayCloses.map((c, k) => {
    const o = k === 0 ? c : todayCloses[k - 1];
    return bar(OPEN + DAY + k * 300, o, Math.max(o, c) + 2, Math.min(o, c) - 2, c);
  });
  return [...y, ...t];
}

test('pivot, CPR, R1/S1 and Camarilla come from the textbook formulas', () => {
  const lv = levelsFrom(24100, 24000, 24080);
  assert.ok(Math.abs(lv.pp - 24060) < 1e-9);
  assert.equal(lv.cprBottom, 24050); // (H + L) / 2
  assert.ok(Math.abs(lv.cprTop - 24070) < 1e-9); // 2P - BC
  assert.ok(Math.abs(lv.r1 - 24120) < 1e-9);
  assert.ok(Math.abs(lv.s1 - 24020) < 1e-9);
  assert.ok(Math.abs(lv.h3 - (24080 + 27.5)) < 1e-9);
  assert.ok(Math.abs(lv.h4 - (24080 + 55)) < 1e-9);
  assert.ok(Math.abs(lv.l4 - (24080 - 55)) < 1e-9);
});

test("the value area holds about 70% of yesterday's time and sits round the busiest price", () => {
  const bars = [...Array.from({ length: 30 }, () => bar(0, 100, 102, 98, 100)), bar(0, 100, 120, 100, 119), bar(0, 90, 100, 80, 81)];
  const va = valueArea(bars);
  assert.ok(va.val >= 96 && va.val <= 98.5, `val ${va.val}`);
  assert.ok(va.vah >= 101.5 && va.vah <= 104, `vah ${va.vah}`);
  assert.ok(va.poc > 98 && va.poc < 102, `poc ${va.poc}`);
});

test('the first day has no levels and every bar of a day shares the levels of the day before', () => {
  const bars = twoDays([24060, 24070, 24080]);
  const ds = bars.map((_, i) => (i < 75 ? 0 : 75));
  const lv = dayLevels(bars, ds);
  assert.equal(lv[10], null);
  assert.equal(lv[75], lv[77]);
  assert.ok(Math.abs(lv[75].pp - 24050) < 1e-9);
});

test('CPR breakout and Camarilla H4 break fire once, on the first close above, and a put is the mirror', () => {
  const closes = [24040, 24045, 24048, 24062, 24070, 24060, 24066, 24072, 24080, 24090, 24112, 24118];
  const bars = twoDays(closes);
  const find = (b, key) => findSignals(prepare(b), { only: [key], windows: false });
  const cpr = find(bars, 'cprBreak');
  assert.deepEqual(cpr.map((s) => [s.side, s.i]), [['CE', 75 + 3]], JSON.stringify(cpr));
  const h4 = find(bars, 'camH4Break');
  assert.deepEqual(h4.map((s) => [s.side, s.i]), [['CE', 75 + 10]]);
  assert.ok(h4[0].stop < h4[0].close);
  assert.deepEqual(find(mirror(bars), 'cprBreak').map((s) => [s.side, s.i]), [['PE', 75 + 3]]);
  assert.deepEqual(find(mirror(bars), 'camH4Break').map((s) => [s.side, s.i]), [['PE', 75 + 10]]);
  assert.ok(TECHNIQUES.find((t) => t.key === 'cprBreak').extra, 'new patterns stay out of the old "together" rows');
});

test('the new checks hold where they should, for calls and on the mirrored chart for puts', () => {
  const closes = [24040, 24045, 24048, 24062, 24070, 24060, 24066, 24072, 24080, 24090, 24112, 24118];
  const bars = twoDays(closes);
  const chart = buildChart(bars);
  const m = buildChart(mirror(bars));
  const at = (ch, key, d, i) => holds(ch, CONDITION_BY_KEY.get(key), d, i);
  assert.equal(at(chart, 'cprBreakUp', 1, 78), true);
  assert.equal(at(chart, 'cprBreakUp', 1, 79), false, 'only the first close above');
  assert.equal(at(chart, 'aboveCpr', 1, 79), true);
  assert.equal(at(chart, 'r1Break', 1, 85), true);
  assert.equal(at(chart, 'aboveR1', 1, 86), true);
  assert.equal(at(chart, 'camH4Up', 1, 85), true);
  assert.equal(at(m, 'cprBreakUp', -1, 78), true, 'the put twin on the mirrored chart');
  assert.equal(at(m, 'r1Break', -1, 85), true);
  assert.equal(at(chart, 'abovePivot', 1, 10), false, 'no levels on the first day');
  assert.ok(GROUPS.includes('Pivots and levels'));
  for (const key of ['vwapBand1', 'aboveVwap2d', 'mfiCross50']) assert.equal(CONDITION_BY_KEY.get(key).needs, 'flow', key);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { movedMeasures, movedSkip, movedOf, movedWords, MOVED_CHECKS } from '../src/options/moved.js';
import { tradesFor } from '../src/study/optionsStudy.js';
import { PriceBook } from '../src/study/priceBook.js';
import { runMovedTest, movedCandidates, recommendMoved, blockedVs, bandsOf } from '../src/study/movedTest.js';

const OPEN = Date.UTC(2026, 10, 3, 3, 45) / 1000; // 3 Nov 2026, 09:15 IST
const DAY = '2026-11-03';
// the day before: flat; then today the index climbs 1 point a minute from 23500 for 90 minutes
const yesterday = Array.from({ length: 375 }, (_, i) => ({ time: OPEN - 86400 + i * 60, open: 23500, high: 23502, low: 23498, close: 23500, volume: 0 }));
const today = Array.from({ length: 90 }, (_, i) => ({ time: OPEN + i * 60, open: 23500 + i, high: 23501 + i, low: 23499.5 + i, close: 23501 + i, volume: 0 }));
const bars = [...yesterday, ...today];
const byTime = new Map(bars.map((b, i) => [b.time, i]));

test('the already-moved measures: run from the recent low, move since the open, stretch and RSI, in the trade direction', () => {
  const now = OPEN + 60 * 60; // 10:15
  const ce = movedMeasures(bars, { price: 23560, now, side: 'CE', atr: 10 });
  assert.equal(ce.run30, 0.13, '23560 against the 30-minute low 23529.5');
  assert.equal(ce.points.run30, 30.5);
  assert.equal(ce.run60, 0.26, 'from the low 23499.5 of the first minute');
  assert.equal(ce.day, 0.26, 'from the open 23500');
  assert.ok(ce.stretch > 2.5, 'about 30 points over the day average, 3 ATR');
  assert.ok(ce.rsi > 90, 'a steady climb: RSI near 100');
  const pe = movedMeasures(bars, { price: 23560, now, side: 'PE', atr: 10 });
  assert.ok(pe.run30 <= 0 && pe.day < 0 && pe.stretch < 0, 'for a put, the same climb counts against the direction');
  assert.ok(pe.rsi < 10, 'and the put RSI reads 100 minus it');
  const first = movedMeasures(bars, { price: 23500, now: OPEN, side: 'CE', atr: 10 });
  assert.equal(first.run30, null, 'no minute of today yet: unknown, never blocks');
  assert.equal(first.day, null);
});

test('the check skips with a one-line reason, and only past its limit', () => {
  const m = { run30: 0.42, day: 0.3, rsi: 82, stretch: 2, points: { run30: 98 } };
  assert.match(movedSkip(m, { key: 'run30', limit: 0.3 }, { side: 'CE', index: 'Nifty' }), /Nifty is already up 0.42% \(98 points\) from its 30-minute low, over the 0.3% you allow/);
  assert.equal(movedSkip(m, { key: 'run30', limit: 0.5 }), null);
  assert.match(movedSkip(m, { key: 'rsi', limit: 75 }, { side: 'PE' }), /RSI is 18/);
  assert.equal(movedSkip({ run30: null }, { key: 'run30', limit: 0.1 }), null, 'unknown never blocks');
  assert.equal(movedOf({ movedCheck: 'off', movedLimit: 1 }), null);
  assert.equal(movedOf({ movedCheck: 'run30', movedLimit: 0 }), null);
  assert.deepEqual(movedOf({ movedCheck: 'day', movedLimit: 0.5 }), { key: 'day', limit: 0.5 });
  for (const c of MOVED_CHECKS) assert.ok(movedWords({ key: c.key, limit: c.choices[0] }).startsWith('Skip'));
});

const callCandles = today.map((b, i) => ({ time: b.time, open: 150 + i, high: 151 + i, low: 149.5 + i, close: 151 + i, volume: 500, oi: 1000 }));
const book = () => PriceBook.fromContracts([{ day: DAY, expiry: '2026-11-04', strike: 23550, type: 'CE', candles: callCandles }, { day: DAY, expiry: '2026-11-04', strike: 23500, type: 'CE', candles: callCandles }]);

test('the replay skips an entry after the index already ran, counts it, and puts the measures on every trade it takes', () => {
  const signal = { side: 'CE', time: OPEN + 50 * 60, close: 23550, stop: 23520, atr: 20, technique: 'test' };
  const params = { live: true, steps: [], lotSize: 65, holidays: [], prices: book(), maxTrades: 3, strikeStep: 50, exitMin: 15 * 60 + 15 };
  const plain = tradesFor([signal], { c1: bars, byTime, params: { ...params, withMeasures: true } });
  assert.equal(plain.trades.length, 1);
  assert.ok(plain.trades[0].moved.run30 > 0.1, 'the measures ride on the trade');
  const blocked = tradesFor([signal], { c1: bars, byTime, params: { ...params, moved: { key: 'run30', limit: 0.1 } } });
  assert.equal(blocked.trades.length, 0);
  assert.equal(blocked.skips.moved, 1);
  const late = tradesFor([signal], { c1: bars, byTime, params: { ...params, lastEntry: 9 * 60 + 30 } });
  assert.equal(late.skips.late, 1, 'a 10:06 entry is after a 09:30 cut-off');
});

test('the tester picks on the older days, checks on the newer, and says what each limit skipped', async () => {
  const end = 1000;
  // older days: the trades after a big run lost; newer days: the same
  const mk = (time, run30, net) => ({ entryTime: time, exitTime: time + 1, side: 'CE', net, gross: net, best: Math.max(net, 0), reason: 'STOP', moved: { run30, run60: run30, day: run30, stretch: run30 * 10, rsi: 50 + run30 * 50, minutes: 600 } });
  const all = [];
  for (let i = 0; i < 30; i++) all.push(mk(i * 30 + (i < 20 ? 0 : end), i % 3 === 0 ? 0.6 : 0.1, i % 3 === 0 ? -3000 : 1500));
  const tradesFor = (_s, p) => ({ trades: p.moved ? all.filter((t) => !(t.moved[p.moved.key] > p.moved.limit)) : all, skips: {} });
  const r = await runMovedTest({ signals: [1], tradesFor, trainEnd: end, splitOk: true, params: { entryTo: 915 } });
  assert.equal(r.rows[0].key, 'off');
  assert.equal(r.advice.verdict, 'on');
  const pick = r.rows.find((x) => x.key === r.advice.key);
  assert.equal(pick.vsOff.badSkipped, 10);
  assert.equal(pick.vsOff.goodSkipped, 0);
  assert.ok(pick.apply.movedCheck);
  assert.equal(r.bands.run30.reduce((s, b) => s + b.trades, 0), 30);
  assert.equal(recommendMoved(r.rows, { splitOk: false }).verdict, 'short');
});

test('candidates: every family loose to tight, late cut-offs only before your last entry time, saved where the setup lives', () => {
  const rows = movedCandidates({ entryTo: 13 * 60 + 30, entryKey: 'entryTo' });
  const late = rows.filter((r) => r.family === 'late');
  assert.deepEqual(late.map((r) => r.limit), [13 * 60, 12 * 60 + 30, 12 * 60]);
  assert.deepEqual(late[0].apply, { entryTo: 13 * 60 });
  const run30 = rows.filter((r) => r.family === 'run30').map((r) => r.limit);
  assert.deepEqual(run30, [...run30].sort((a, b) => b - a));
  assert.ok(rows.some((r) => r.family === 'chase15'), 'the premium check of the ladder tester is one of the families');
});

test('blockedVs and bands', () => {
  const a = { entryTime: 1, side: 'CE', net: 100 };
  const b = { entryTime: 2, side: 'CE', net: -200 };
  const c = { entryTime: 3, side: 'PE', net: 50 };
  assert.deepEqual(blockedVs([a, b], [a, c]), { skipped: 1, goodSkipped: 0, goodSkippedNet: 0, badSkipped: 1, badSkippedNet: -200, added: 1, addedNet: 50 });
  const bands = bandsOf([{ ...a, moved: { run30: 0.05 } }, { ...b, moved: { run30: 0.7 } }], 'run30');
  assert.equal(bands[0].trades, 1);
  assert.equal(bands.at(-1).net, -200);
});

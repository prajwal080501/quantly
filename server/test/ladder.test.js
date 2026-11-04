import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceBook } from '../src/study/priceBook.js';
import { simulateTrade } from '../src/study/simulate.js';
import { chaseRise, chaseSkip, chaseOf, candlesBefore } from '../src/options/chase.js';
import { candidates, rungLadder, recommend, recommendChase, recommendProtect, runLadderTest, measure, tradeOff, BE_KEEP } from '../src/study/ladderTest.js';
import { ladderProblem } from '../src/models/TradeDefaults.js';

const BASE = Date.UTC(2026, 9, 28, 3, 45) / 1000; // 28 Oct 2026, 09:15 IST
const DAY = '2026-10-28';
const bars = Array.from({ length: 21 }, (_, i) => ({ time: BASE + i * 60, open: 23000 + i, high: 23001.5 + i, low: 22999.5 + i, close: 23001 + i, volume: 1000 }));
const byTime = new Map(bars.map((b, i) => [b.time, i]));
const callCandles = bars.map((b, i) => ({ time: b.time, open: 100 + i, high: 101.5 + i, low: 99.5 + i, close: 101 + i, volume: 500, oi: 1000 }));
const book = () => PriceBook.fromContracts([{ day: DAY, expiry: '2026-11-03', strike: 23000, type: 'CE', candles: callCandles }]);

test('the anti-chase sum: percent above the lowest low of the last minutes, null with no candle', () => {
  const cs = [{ time: 0, low: 100 }, { time: 60, low: 90 }, { time: 120, low: 95 }];
  assert.equal(chaseRise(cs, 108, { now: 180, minutes: 15 }), 20);
  assert.equal(chaseRise(cs, 108, { now: 180, minutes: 1 }), 13.7, 'only the last minute (low 95)');
  assert.equal(chaseRise([], 108, { now: 180 }), null);
  assert.equal(chaseSkip(20, { pct: 15, minutes: 15 }) != null, true);
  assert.equal(chaseSkip(20, { pct: 25, minutes: 15 }), null);
  assert.equal(chaseSkip(null, { pct: 5 }), null, 'unknown never blocks');
  assert.equal(chaseOf({ chasePct: 0 }), null);
  assert.deepEqual(chaseOf({ chasePct: 20 }), { pct: 20, minutes: 15 });
  assert.equal(candlesBefore(new Map([[0, cs[0]], [60, cs[1]]]), 120, 15).length, 2);
});

test('the replay skips a buy whose real premium already ran up past the limit, and records the rise on every trade', () => {
  const signal = { side: 'CE', time: BASE + 2 * 60, stop: 22900, technique: 'test' };
  const params = { steps: [], lotSize: 65, holidays: [], prices: book() };
  const t = simulateTrade({ c1: bars, byTime, signal, params });
  assert.equal(t.rise, 2.5, 'open 102 against the low 99.5 of the two minutes before');
  assert.deepEqual(simulateTrade({ c1: bars, byTime, signal, params: { ...params, chase: { pct: 2, minutes: 15 } } }), { skipped: 'chase', rise: 2.5 });
  assert.equal(simulateTrade({ c1: bars, byTime, signal, params: { ...params, chase: { pct: 5, minutes: 15 } } }).priced, 'real');
});

test('every ladder the tester tries is one the Account form accepts', () => {
  for (const c of candidates([{ at: 3500, keep: 3000 }, { at: 4500, keep: 4000 }])) assert.equal(ladderProblem(c.steps), null, c.key);
  const l = rungLadder(1500, 750);
  assert.deepEqual(l.slice(0, 3), [{ at: 1500, keep: BE_KEEP }, { at: 2250, keep: 1500 }, { at: 3000, keep: 2250 }]);
  const keys = candidates([{ at: 3500, keep: 3000 }]).map((c) => c.key);
  assert.ok(keys.includes('be1500'), 'a break-even rung in front of your ladder');
  assert.ok(!candidates([]).some((c) => c.family === 'early'), 'no early rung without a ladder');
});

const row = (key, fit, check, extra = {}) => ({ key, label: key, family: 'grid', pickScore: fit, fit: { trades: 20, net: fit }, check: { trades: 10, net: check }, ...extra });

test('a ladder is recommended only when it wins on the older days and holds up on the newest days', () => {
  const cur = row('current', 1000, 500, { family: 'current' });
  assert.equal(recommend([cur, row('a', 3000, 900)], { splitOk: true }).verdict, 'change');
  const failed = recommend([cur, row('a', 3000, 100)], { splitOk: true });
  assert.equal(failed.verdict, 'keep');
  assert.equal(failed.tried, 'a');
  assert.equal(recommend([cur, row('a', 800, 9000)], { splitOk: true }).verdict, 'keep', 'the newest days never pick');
  assert.equal(recommend([cur, row('a', 3000, 900)], { splitOk: false }).verdict, 'short');
  assert.equal(recommend([cur, { ...row('a', 3000, 900), fit: { trades: 3, net: 3000 } }], { splitOk: true }).verdict, 'few');
  const off = row('off', 1000, 500);
  assert.equal(recommendChase([off, { ...row('c20', 2000, 600), pct: 20, minutes: 15 }], { splitOk: true }).verdict, 'on');
  assert.equal(recommendChase([off, { ...row('c20', 2000, 400), pct: 20, minutes: 15 }], { splitOk: true }).verdict, 'off');
});

test('the tester runs every ladder through the trader, scores give-back and reversed winners, and tries the chase check', async () => {
  const end = 1000;
  // two trades before the split, one after; a trade that was +1,500 at best ends -300 with a late ladder and +200 with an early one
  const tradesFor = (_sigs, p) => {
    const early = p.steps[0]?.at <= 1500;
    const mk = (entryTime, best, net, rise) => ({ entryTime, exitTime: entryTime + 60, side: 'CE', best, gross: net + 60, net, minutes: 5, reason: 'LOCK', rise });
    const trades = [mk(100, 1500, early ? 200 : -300, 5), mk(200, 4000, early ? 2500 : 3200, 35), mk(1100, 1600, early ? 300 : -250, 8)];
    const kept = p.chase ? trades.filter((t) => t.rise <= p.chase.pct) : trades;
    return { trades: kept, skips: { chase: trades.length - kept.length } };
  };
  const r = await runLadderTest({ signals: [1, 2, 3], tradesFor, trainEnd: end, splitOk: true, params: { steps: [{ at: 3500, keep: 3000 }] } });
  const cur = r.rows.find((x) => x.key === 'current');
  assert.equal(cur.all.reversed, 2, 'two trades were +₹1,000 at best and ended in a loss');
  assert.equal(r.riseBands.find((b) => b.from === 30).trades, 1);
  assert.ok(r.rows.length > 20);
  assert.equal(r.chase.rows[0].key, 'off');
  assert.ok(['change', 'keep', 'few'].includes(r.advice.verdict));
  assert.equal(measure([]).trades, 0);
});

test('the trade-off: trades saved from a loss against big winners cut short, on the same entries', () => {
  const t = (entryTime, best, net) => ({ entryTime, side: 'CE', best, net });
  const yours = [t(1, 1600, -2000), t(2, 2000, 4000), t(3, 500, -1000)];
  const early = [t(1, 1600, 150), t(2, 2000, 150), t(3, 500, -1000)];
  assert.deepEqual(tradeOff(yours, early), { saved: 1, savedRs: 2150, cut: 1, cutRs: -3850, matched: 3 });
});

test('the protect pick moves the stop to break-even by +1,500 and says what it saved and what it cost', () => {
  const all = (net, reversed) => ({ trades: 20, net, reversed, reversedLoss: -4000, atBreakEven: 3 });
  const cur = { key: 'current', steps: [{ at: 3500, keep: 3000 }], pickScore: 0, fit: { trades: 20, net: 0 }, check: { trades: 10, net: 100 }, all: all(100, 2) };
  const late = { key: 'r2500-500', steps: [{ at: 2500, keep: 200 }], pickScore: 9000, fit: { trades: 20, net: 9000 }, check: { trades: 10, net: 900 }, all: all(9900, 1) };
  const early = { key: 'r1500-750', steps: [{ at: 1500, keep: 200 }], pickScore: 500, fit: { trades: 20, net: 500 }, check: { trades: 10, net: 300 }, all: all(800, 0), tradeOff: { saved: 2, savedRs: 4300, cut: 1, cutRs: -3800 } };
  const p = recommendProtect([cur, late, early], { splitOk: true });
  assert.equal(p.key, 'r1500-750', 'a first rung over 1,500 is not a protect pick');
  assert.equal(p.verdict, 'holds');
  assert.match(p.text, /saved 2 trades/);
  assert.match(p.text, /cut 1 big winner short/);
});

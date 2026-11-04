import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildReplay } from '../src/report/replay.js';
import { marketMood, todayVerdict } from '../src/options/todayCheck.js';
import { hardLossOf, planTrade } from '../src/options/plan.js';
import { lossesInARow, liveSkip } from '../src/study/optionsStudy.js';
import { normalizeCombo, comboSignals, describeCombo } from '../src/combos/combos.js';
import { comboSchema } from '../src/combos/schema.js';

const OPEN = Date.UTC(2026, 10, 3, 3, 45) / 1000; // 3 Nov 2026, 09:15 IST
const at = (min) => new Date((OPEN + min * 60) * 1000);

test('trade replay: the profit each minute, the best and worst inside it, and what went wrong', () => {
  // a call bought at 100 for 130 qty: it climbs to 112 by minute 6, then falls to the exit at 76
  const path = [101, 103, 106, 108, 110, 111, 104, 96, 88, 80, 76];
  const candles = path.map((c, i) => ({ time: OPEN + i * 60, open: i ? path[i - 1] : 100, high: Math.max(c, i ? path[i - 1] : 100) + (i === 5 ? 1 : 0), low: Math.min(c, i ? path[i - 1] : 100), close: c }));
  const position = { _id: 'p1', symbol: 'NIFTY-20261104-24000-CE', segment: 'OPT', direction: 'LONG', status: 'CLOSED', buyQty: 130, sellQty: 130, buyValue: 13000, sellValue: 130 * 76, realizedPnl: 130 * -24, charges: 99, openedAt: at(0), closedAt: at(10), tradingDay: '2026-11-03' };
  const fills = [{ side: 'BUY', role: 'ENTRY', qty: 130, price: 100, executedAt: at(0) }, { side: 'SELL', role: 'STOPLOSS', qty: 130, price: 76, executedAt: at(10) }];
  const log = { setup: 'Combination: Breakout + RSI', score: 72, detail: { trigger: { kind: 'Combination: Breakout + RSI', level: 24010 }, stopSpot: 23960, entrySpot: 24000 }, card: { checks: [{ label: 'RSI over 50', points: 10, max: 10 }] }, outcome: { exitReason: 'STOP' } };
  const r = buildReplay({ position, candles, fills, log, rules: { stopLoss: 3000, steps: [{ at: 3500, keep: 2750 }], lockOn: true } });
  assert.equal(r.minutes.length, 11);
  assert.equal(r.minutes[0].pnl, 130);
  assert.equal(r.minutes.at(-1).pnl, -3120, 'the last minute is counted at the exit price');
  assert.equal(r.summary.peak, 130 * 12, 'best is the high inside minute 6');
  assert.equal(r.summary.peakMinute, 6);
  assert.equal(r.summary.final, -3120 - 99);
  assert.equal(r.summary.minutesInProfit, 7);
  assert.ok(r.lessons.some((t) => /ladder only starts at \+₹3,500/.test(t)), 'it says the ladder never protected the +1,560');
  assert.ok(r.lessons.some((t) => /more than your/.test(t)), 'it says the loss was over the limit');
  assert.equal(r.why.source, 'Combination: Breakout + RSI');
  assert.equal(r.why.checks[0].ok, true);
  assert.equal(r.fills[1].role, 'STOPLOSS');
});

test('trade replay without saved candles says so instead of drawing anything', () => {
  const position = { symbol: 'TCS', segment: 'EQ', direction: 'SHORT', status: 'CLOSED', buyQty: 10, sellQty: 10, buyValue: 39000, sellValue: 39500, realizedPnl: 500, charges: 20, openedAt: at(0), closedAt: at(30), tradingDay: '2026-11-03' };
  const r = buildReplay({ position });
  assert.equal(r.minutes.length, 0);
  assert.equal(r.summary, null);
  assert.equal(r.entry, 3950);
  assert.equal(r.kind, 'Sold shares first');
  assert.ok(r.lessons.some((t) => /No 1-minute candles/.test(t)));
});

test('the loss cap: the hard premium stop sits at the limit less charges, or the old 1.3 times it', () => {
  assert.equal(hardLossOf(3000, { capLoss: true, charges: 100 }), 2900);
  assert.equal(hardLossOf(3000, { capLoss: false }), 3900);
  assert.equal(hardLossOf(0), null);
  const read = { stop: { price: 23950, note: '' } };
  const contract = { symbol: 'NIFTY-20261110-24000-CE', lotSize: 65 };
  const args = { read, market: { spot: 24000 }, contract, premium: 120, rules: { stopLoss: 3000, lockStart: 3500, lockGap: 750 }, available: 500000, now: new Date('2026-11-04T05:00:00Z') };
  const capped = planTrade({ ...args, settings: { budget: 100000, maxLots: 2 } }).plan;
  const old = planTrade({ ...args, settings: { budget: 100000, maxLots: 2, capLoss: false } }).plan;
  assert.ok(capped.worstCase <= 3000 - capped.charges + capped.qty * 0.05, `worst case ${capped.worstCase} stays inside the limit after charges`);
  assert.ok(old.worstCase > 3800, 'the old way could lose 1.3 times the limit');
});

test('losses in a row stop the day, in the live rules replayed by the study', () => {
  assert.equal(lossesInARow([500, -200, -300]), 2);
  assert.equal(lossesInARow([-200, 300]), 0);
  const t = (min, net) => ({ side: 'CE', entryTime: OPEN + min * 60, exitTime: OPEN + (min + 10) * 60, net });
  const trades = [t(0, -1000), t(40, -1200)];
  const s = { side: 'PE', time: OPEN + 120 * 60 };
  assert.equal(liveSkip(s, trades, { maxPerDay: 5, lossStreak: 2 }), 'loss streak');
  assert.equal(liveSkip(s, trades, { maxPerDay: 5, lossStreak: 0 }), null);
});

test('a saved combination keeps its calls-only lock, its extra checks and the day it was benched', () => {
  const M = mongoose.models.ComboProbe || mongoose.model('ComboProbe', new mongoose.Schema({ combos: [comboSchema] }));
  const doc = new M({ combos: [{ id: 'a', name: 'A', conds: ['aboveEma20'], side: 'CE', also: ['adxStrong'], on: false, benchedOn: '2026-11-03' }] });
  const saved = doc.toObject().combos[0];
  assert.equal(saved.side, 'CE', 'the side lock used to be dropped on save');
  assert.deepEqual(saved.also, ['adxStrong']);
  assert.equal(saved.benchedOn, '2026-11-03');
  const n = normalizeCombo({ name: 'A', conds: ['aboveEma20'], also: ['adxStrong', 'aboveEma20', 'nope'], on: false, benchedOn: '2026-11-03' });
  assert.deepEqual(n.also, ['adxStrong'], 'unknown checks and repeats of its own checks are dropped');
  assert.equal(n.benchedOn, '2026-11-03');
  assert.equal(normalizeCombo({ name: 'A', conds: ['aboveEma20'], on: true, benchedOn: '2026-11-03' }).benchedOn, undefined, 'turned back on, it is not benched any more');
  assert.match(describeCombo(n), /and also ADX over 25/);
});

test('the market mood: a straight day is a trend, a back-and-forth day is chop', () => {
  const mk = (f) => Array.from({ length: 120 }, (_, i) => { const c = f(i); return { time: OPEN + i * 60, open: c, high: c + 1, low: c - 1, close: c }; });
  const trend = marketMood(mk((i) => 24000 + i));
  const chop = marketMood(mk((i) => 24000 + (Math.floor(i / 5) % 2 ? 20 : 0)));
  assert.equal(trend.kind, 'trend');
  assert.equal(trend.direction, 'up');
  assert.equal(chop.kind, 'chop');
  const me = { pnl: -500, trades: 1, maxTrades: 3, dailyLoss: 6000, lossesInARow: 1, lossStreak: 2, paused: false, capLoss: true, benched: [] };
  assert.equal(todayVerdict(trend, me, { minutes: 11 * 60 }).verdict, 'care', 'one loss in a row asks for care');
  assert.equal(todayVerdict(trend, { ...me, lossesInARow: 0 }, { minutes: 11 * 60 }).verdict, 'go');
  assert.equal(todayVerdict(chop, { ...me, lossesInARow: 0 }, { minutes: 11 * 60 }).verdict, 'care');
  assert.equal(todayVerdict(trend, { ...me, lossesInARow: 2 }, { minutes: 11 * 60 }).verdict, 'stop');
});

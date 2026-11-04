import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { marketMood, todayVerdict } from '../src/options/todayCheck.js';
import { lossesInARow, liveSkip } from '../src/study/optionsStudy.js';
import { normalizeCombo } from '../src/combos/combos.js';
import { comboSchema } from '../src/combos/schema.js';

const OPEN = Date.UTC(2026, 10, 3, 3, 45) / 1000; // 3 Nov 2026, 09:15 IST

test('losses in a row stop the day, in the live rules replayed by the study', () => {
  assert.equal(lossesInARow([500, -200, -300]), 2);
  assert.equal(lossesInARow([-200, 300]), 0);
  const t = (min, net) => ({ side: 'CE', entryTime: OPEN + min * 60, exitTime: OPEN + (min + 10) * 60, net });
  const trades = [t(0, -1000), t(40, -1200)];
  const s = { side: 'PE', time: OPEN + 120 * 60 };
  assert.equal(liveSkip(s, trades, { maxPerDay: 5, lossStreak: 2 }), 'loss streak');
  assert.equal(liveSkip(s, trades, { maxPerDay: 5, lossStreak: 0 }), null);
});

test('a saved combination keeps its calls-only lock and the day it was benched', () => {
  const M = mongoose.models.ComboProbe || mongoose.model('ComboProbe', new mongoose.Schema({ combos: [comboSchema] }));
  const doc = new M({ combos: [{ id: 'a', name: 'A', conds: ['aboveEma20'], side: 'CE', on: false, benchedOn: '2026-11-03' }] });
  const saved = doc.toObject().combos[0];
  assert.equal(saved.side, 'CE', 'the side lock used to be dropped on save');
  assert.equal(saved.benchedOn, '2026-11-03');
  const n = normalizeCombo({ name: 'A', conds: ['aboveEma20'], on: false, benchedOn: '2026-11-03' });
  assert.equal(n.benchedOn, '2026-11-03');
  assert.equal(normalizeCombo({ name: 'A', conds: ['aboveEma20'], on: true, benchedOn: '2026-11-03' }).benchedOn, undefined, 'turned back on, it is not benched any more');
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

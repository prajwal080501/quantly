import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateStock } from '../src/scanner/evaluate.js';
import { ema, rsi } from '../src/signals/indicators.js';

// Fixed candles. The expected signal is the output of the audited tree and must not move when safety code changes.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/signal-baseline.json', import.meta.url), 'utf8'));

const DAY = 86400;
const T0 = Date.UTC(2026, 9, 21, 3, 45) / 1000;
const T1 = T0 + DAY;
function session(start, n, close, vol = () => 1000) {
  const out = [];
  let prev = close(0);
  for (let i = 0; i < n; i++) {
    const c = close(i);
    out.push({ time: start + i * 60, open: prev, high: Math.max(prev, c) + 0.2, low: Math.min(prev, c) - 0.2, close: c, volume: vol(i) });
    prev = c;
  }
  return out;
}

test('opening-range and indicator outputs on the frozen fixture are unchanged', () => {
  const prior = session(T0, 375, (i) => 1000 + (i % 2 ? 1 : -1));
  const or = session(T1, 15, (i) => 1004 + 3.8 * Math.sin(i * 0.9), () => 1000);
  const orHigh = Math.max(...or.map((b) => b.high));
  const climb = session(T1 + 15 * 60, 15, (i) => orHigh - 2 + (3 * (i + 1)) / 15, () => 3000);
  const stay = session(T1 + 30 * 60, 3, () => orHigh + 0.6, () => 3000);
  const c1 = [...prior, ...or, ...climb, ...stay];
  assert.equal(c1.length, baseline.barCount);
  const today = c1.filter((b) => b.time >= T1);
  const tick = {
    symbol: 'X', ltp: c1.at(-1).close, open: 1000,
    high: Math.max(...today.map((b) => b.high)),
    low: Math.min(...today.map((b) => b.low)),
    prevClose: 1000, changePct: 1, totalBuyQty: 7000, totalSellQty: 3000,
  };
  const { candidates } = evaluateStock({ symbol: 'X', tick, c1, niftyChangePct: 0.3 }, { now: new Date('2026-10-22T05:00:00Z'), enforceWindows: true });
  const slim = candidates.map((c) => ({
    setup: c.setup, side: c.side, status: c.status, entry: c.entry, stopLoss: c.stopLoss,
    target1: c.target1, target2: c.target2, score: c.score, riskReward: c.riskReward, blocked: c.blocked,
  }));
  assert.deepEqual(slim, baseline.candidates);
  const bars = c1.map((b) => ({ close: b.close, high: b.high, low: b.low, time: b.time }));
  assert.equal(ema(bars, 9).at(-1)?.value ?? null, baseline.indicators.ema9Last);
  assert.equal(rsi(bars, 14).at(-1)?.value ?? null, baseline.indicators.rsi14Last);
});

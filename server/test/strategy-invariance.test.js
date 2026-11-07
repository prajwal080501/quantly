import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

  const mirrored = c1.map((b) => ({ ...b, open: 2000 - b.open, close: 2000 - b.close, high: 2000 - b.low, low: 2000 - b.high }));
  const shortTick = {
    symbol: 'X', ltp: mirrored.at(-1).close, open: 1000,
    high: Math.max(...mirrored.filter((b) => b.time >= T1).map((b) => b.high)),
    low: Math.min(...mirrored.filter((b) => b.time >= T1).map((b) => b.low)),
    prevClose: 1000, changePct: -1, totalBuyQty: 3000, totalSellQty: 7000,
  };
  const short = evaluateStock({ symbol: 'X', tick: shortTick, c1: mirrored, niftyChangePct: -0.3 }, { now: new Date('2026-10-22T05:00:00Z'), enforceWindows: true }).candidates
    .filter((c) => c.setup === 'Opening range breakout' && c.side === 'SELL')
    .map((c) => ({ setup: c.setup, side: c.side, status: c.status, entry: c.entry, stopLoss: c.stopLoss, score: c.score }));
  assert.deepEqual(short, baseline.shortOrb);
});

test('setup, indicator, signal, news, and pattern files match the audited commit byte for byte', () => {
  const files = JSON.parse(readFileSync(new URL('./fixtures/strategy-file-hashes.json', import.meta.url), 'utf8'));
  assert.ok(files.length >= 30);
  const changed = [];
  for (const row of files) {
    const body = readFileSync(new URL(`../../${row.path}`, import.meta.url));
    const sha = createHash('sha256').update(body).digest('hex');
    if (sha !== row.sha256) changed.push(row.path);
  }
  assert.deepEqual(changed, []);
});

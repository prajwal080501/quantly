import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStand, dayBiasSkip, streakSkip, dayBiasOf } from '../src/options/dayBias.js';
import { replayRows, diagnose, lockAt, tradeShape } from '../src/review/replay.js';

const OPEN = Date.UTC(2026, 10, 4, 3, 45) / 1000; // 09:15 IST
const rising = (n, from = 23700, step = 2) => Array.from({ length: n }, (_, i) => ({ time: OPEN + i * 60, open: from + i * step, high: from + i * step + 3, low: from + i * step - 3, close: from + i * step + 1 }));

test('with the day: a call needs the index above its open and its average, a put below both, and early in the day it lets trades through', () => {
  const c1 = rising(60);
  const now = OPEN + 60 * 60;
  const stand = dayStand(c1, { now, price: 23820 });
  assert.equal(stand.up, true);
  assert.equal(dayBiasSkip(stand, { on: true }, { side: 'CE' }), null);
  assert.match(dayBiasSkip(stand, { on: true }, { side: 'PE' }), /no put/);
  assert.equal(dayBiasSkip(stand, null, { side: 'PE' }), null, 'off: never says no');
  assert.equal(dayStand(c1.slice(0, 10), { now: OPEN + 10 * 60, price: 23720 }), null, 'before 15 bars there is no verdict');
  assert.deepEqual(dayBiasOf({ withDay: true }), { on: true });
  assert.equal(dayBiasOf({}), null);
});

test('the losing-streak pause rests an entry after that many losses in a row today, and a win in between resets it', () => {
  assert.equal(streakSkip([{ net: -1 }, { net: -2 }], 2) != null, true);
  assert.equal(streakSkip([{ net: -1 }, { net: 5 }], 2), null);
  assert.equal(streakSkip([{ net: -1 }], 2), null);
  assert.equal(streakSkip([{ net: -1 }, { net: -1 }], 0), null, '0 = off');
});

test('the trade replay gives one row per minute held, with the profit at the close, the best so far and where the ladder kept the stop', () => {
  const bars = Array.from({ length: 12 }, (_, i) => ({ time: OPEN + i * 60, open: 200 + i * 5, high: 202 + i * 5, low: 198 + i * 5, close: 201 + i * 5 }));
  const pos = { direction: 'LONG', buyQty: 130, buyValue: 200 * 130, sellQty: 130, sellValue: 250 * 130, netQty: 0, avgPrice: 200 };
  const shape = tradeShape(pos);
  assert.deepEqual(shape, { long: true, qty: 130, entry: 200, exit: 250 });
  const { rows, hardStopPnl } = replayRows({ bars, shape, from: OPEN + 10, to: OPEN + 9 * 60 + 30, ladder: { steps: [{ at: 3500, keep: 2750 }] }, hardStop: 177 });
  assert.equal(rows.length, 10, 'minutes 09:15 to 09:24');
  assert.equal(rows[0].pnl, 130);
  assert.equal(rows[9].best, (247 - 200) * 130);
  assert.equal(rows[9].lock, (247 - 200) * 130 - 750, 'above the rung the stop follows 750 behind the best');
  assert.equal(rows[0].lock, null);
  assert.equal(hardStopPnl, -2990);
  assert.equal(lockAt(1000, { lockTrigger: 1000, lockAmount: 300 }), 300);
});

test('the replay explains a loss: wrong from the start, over the limit, and a put bought on an up day', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ time: OPEN + i * 60, minute: i + 1, pnl: -300 * i, pnlHigh: i === 0 ? 150 : -300 * i + 50, pnlLow: -300 * i - 100 }));
  const lines = diagnose({ rows, net: -3955, charges: 100, limit: 3000, side: 'PE', day: { open: 23700, entry: 23800, exit: 23850 } }).map((l) => l.text);
  assert.ok(lines.some((t) => /Wrong from the start/.test(t)));
  assert.ok(lines.some((t) => /more than your ₹3,000 limit/.test(t)));
  assert.ok(lines.some((t) => /put while the index was up/.test(t)));
  const gaveBack = diagnose({ rows: [{ time: OPEN, minute: 1, pnlHigh: 2500, pnlLow: 0 }, { time: OPEN + 60, minute: 2, pnlHigh: 100, pnlLow: -3000 }], net: -3000 }).map((l) => l.text);
  assert.ok(gaveBack.some((t) => /exit problem/.test(t)));
  assert.match(diagnose({ rows: [], net: 0 })[0].text, /No minute candles/);
});

import { tradesFor } from '../src/study/optionsStudy.js';

test('the study honours "with the day only": on a rising day a put signal is skipped and counted, a call is taken', () => {
  const start = Date.UTC(2026, 9, 12, 3, 45) / 1000; // 09:15 IST, a Monday
  let price = 24000;
  const c1 = Array.from({ length: 200 }, (_, i) => {
    const open = price;
    price += 0.5;
    return { time: start + i * 60, open, high: price + 0.5, low: open - 0.5, close: price, volume: 0 };
  });
  const byTime = new Map(c1.map((b, i) => [b.time, i]));
  const at = start + 60 * 60;
  const base = { technique: 'x', note: '', atr: 20, close: c1[60].open };
  const params = { iv: 0.14, lockStart: 1000, lockGap: 250, lotSize: 65, holidays: [], expiryWeekday: 2, withDay: { on: true } };
  const put = tradesFor([{ ...base, side: 'PE', time: at, stop: c1[60].open + 25 }], { c1, byTime, params });
  assert.equal(put.trades.length, 0);
  assert.equal(put.skips.withDay, 1);
  const call = tradesFor([{ ...base, side: 'CE', time: at, stop: c1[60].open - 25 }], { c1, byTime, params });
  assert.equal(call.trades.length, 1);
});

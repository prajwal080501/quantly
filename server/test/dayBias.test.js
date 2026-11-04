import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStand, dayBiasSkip, streakSkip, dayBiasOf } from '../src/options/dayBias.js';

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

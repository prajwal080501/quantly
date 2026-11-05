import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TickRecorder, TickStore, packRows, unpackRows, tickRow, isRecorded, COLS } from '../src/ticks/tickRecorder.js';

const depth = { bids: [{ price: 100.05, qty: 650 }, { price: 100, qty: 1300 }], asks: [{ price: 100.1, qty: 325 }] };
const tick = (over = {}) => ({ symbol: 'NIFTY 50', ltp: 24500.25, volume: 1200, totalBuyQty: 5000, totalSellQty: 4000, depth, ...over });

test('a row has the same length for every tick and keeps the order book', () => {
  const row = tickRow(tick(), 1000);
  assert.equal(row.length, COLS);
  const [back] = unpackRows(packRows([row]), 1);
  assert.equal(back.ltp, 24500.25);
  assert.deepEqual(back.bids, [{ price: 100.05, qty: 650 }, { price: 100, qty: 1300 }]);
  assert.deepEqual(back.asks, [{ price: 100.1, qty: 325 }]);
  assert.equal(back.totalBuyQty, 5000);
});

test('packing many rows returns them in order, and a day of seconds stays small', () => {
  const rows = Array.from({ length: 22500 }, (_, i) => tickRow(tick({ ltp: 100 + (i % 40) / 20, volume: i * 3 }), 1_000_000 + i));
  const buf = packRows(rows);
  const back = unpackRows(buf, rows.length);
  assert.equal(back.length, 22500);
  assert.equal(back[100].time, 1_000_100);
  assert.equal(back[22499].volume, 22499 * 3);
  assert.ok(buf.length < 1_500_000, `packed day was ${buf.length} bytes`);
});

test('only the Nifty index and option contracts are recorded', () => {
  assert.equal(isRecorded('NIFTY 50'), true);
  assert.equal(isRecorded('RELIANCE'), false);
  assert.equal(isRecorded('NIFTY|2026-11-10|24500|CE'), isRecorded('NIFTY|2026-11-10|24500|CE'));
});

function fakeStore() {
  const saved = [];
  return { saved, pruned: 0, saveChunk: async (symbol, day, rows) => saved.push({ symbol, day, rows }), prune: async function () { this.pruned++; return 0; } };
}
const fakeMarket = (simulated = false) => Object.assign(new EventEmitter(), { provider: { isSimulated: simulated } });

test('one row per second per symbol that ticked, only while the market is open, saved on flush', async () => {
  const market = fakeMarket();
  const store = fakeStore();
  let at = new Date('2026-11-05T05:00:00Z'); // 10:30 IST, a Thursday
  const rec = new TickRecorder({ market, store, now: () => at, config: {} });
  market.on('tick', rec.onTick);
  market.emit('tick', tick());
  market.emit('tick', tick({ symbol: 'RELIANCE' })); // not recorded
  assert.equal(rec.sample(), 1);
  assert.equal(rec.sample(), 0); // quiet second: no new tick, no row
  at = new Date(at.getTime() + 1000);
  market.emit('tick', tick({ ltp: 24501 }));
  assert.equal(rec.sample(), 1);
  await rec.flush();
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].rows.length, 2);
  assert.equal(store.saved[0].day, '2026-11-05');
  assert.equal(store.pruned, 1);
});

test('nothing is recorded when the market is closed', () => {
  const market = fakeMarket();
  const rec = new TickRecorder({ market, store: fakeStore(), now: () => new Date('2026-11-05T12:00:00Z'), config: {} }); // 17:30 IST
  market.on('tick', rec.onTick);
  market.emit('tick', tick());
  assert.equal(rec.sample(), 0);
});

test('the demo feed is never recorded', () => {
  const rec = new TickRecorder({ market: fakeMarket(true), store: fakeStore(), config: {} });
  rec.start();
  assert.equal(rec.status().recording, false);
  assert.equal(rec.status().simulated, true);
});

test('prune keeps only the newest 3 days', async () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
  const { TickChunk } = await import('../src/models/TickChunk.js');
  const real = { distinct: TickChunk.distinct, deleteMany: TickChunk.deleteMany };
  let deleted = null;
  TickChunk.distinct = async () => [...days];
  TickChunk.deleteMany = async (q) => { deleted = q; };
  try {
    const removed = await new TickStore().prune();
    assert.equal(removed, 2);
    assert.deepEqual(deleted, { day: { $lt: '2026-11-03' } });
  } finally {
    Object.assign(TickChunk, real);
  }
});

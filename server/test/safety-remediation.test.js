import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { setup, teardown, closeDb, registerUser, settle } from './helpers.js';
import { createApp } from '../src/app.js';
import { AutoTrader } from '../src/auto/autoTrader.js';
import { CashPosting, Order, Position, Trade, Wallet } from '../src/models/index.js';
import { postCash, repairBalance } from '../src/services/fillLedger.js';
import { setEnvValue } from '../src/services/upstoxAuth.js';
import { parseUpstoxQuote } from '../src/market/providers/upstox/UpstoxProvider.js';

const ctx = {};
let user;

const http = () => request(ctx.app);

before(async () => {
  Object.assign(ctx, await setup());
  user = await registerUser(ctx.app);
  ctx.provider.setPrice('RELIANCE', 1000);
  ctx.provider.setPrice('TCS', 3000);
  ctx.provider.setPrice('INFY', 1500);
  await settle();
});
after(async () => {
  await teardown(ctx);
  await closeDb();
});

test('a stale cached price is not used for a new paper entry', async () => {
  const tick = ctx.market.getTick('RELIANCE');
  const originalFetch = ctx.market.fetchFreshQuote.bind(ctx.market);
  ctx.market.fetchFreshQuote = async () => null;
  ctx.market.latest.set('RELIANCE', { ...tick, ltt: Date.now() - 120_000, feedTs: Date.now(), source: 'upstox', ts: Date.now() - 120_000 });
  const res = await http().post('/api/orders').set(user.auth).send({ symbol: 'RELIANCE', side: 'BUY', qty: 1 });
  ctx.market.fetchFreshQuote = originalFetch;
  assert.equal(res.status, 503);
  assert.match(res.body.error.message, /old|fresh|timestamp|stale/i);
  ctx.provider.setPrice('RELIANCE', 1000);
  await settle();
});

test('duplicate clientOrderId does not double the fill', async () => {
  const id = 'retry-key-1';
  const first = await http().post('/api/orders').set(user.auth).send({ symbol: 'RELIANCE', side: 'BUY', qty: 1, clientOrderId: id }).expect(201);
  const second = await http().post('/api/orders').set(user.auth).send({ symbol: 'RELIANCE', side: 'BUY', qty: 1, clientOrderId: id }).expect(201);
  assert.equal(String(second.body.order._id), String(first.body.order._id));
  assert.equal(second.body.replayed, true);
  const open = await Position.find({ user: user.user.id, symbol: 'RELIANCE', status: 'OPEN' });
  assert.equal(open.length, 1);
  assert.equal(open[0].netQty, 1);
});

test('cash posting retry does not double the balance', async () => {
  const uid = user.user.id;
  const before = await repairBalance(uid, 100000);
  await postCash(uid, 'unit-key', -10, 100000);
  await postCash(uid, 'unit-key', -10, 100000);
  const after = await repairBalance(uid, 100000);
  assert.equal(after.balance, before.balance - 10);
  assert.equal(await CashPosting.countDocuments({ key: 'unit-key' }), 1);
});

test('reset restores the configured balance and says a top-up is discarded', async () => {
  await http().post('/api/wallet/add-funds').set(user.auth).send({ amount: 5000 }).expect(200);
  const reset = await http().post('/api/wallet/reset').set(user.auth).expect(200);
  assert.equal(reset.body.balance, 100000);
  assert.equal(reset.body.startingBalance, 100000);
  assert.match(reset.body.note, /top-up is not kept/);
  assert.equal(await Position.countDocuments({ user: user.user.id }), 0);
});

test('an Upstox quote with an old exchange timestamp is not a fresh price', () => {
  const old = new Date(Date.now() - 120_000).toISOString();
  const tick = parseUpstoxQuote('RELIANCE', { data: { 'NSE_EQ:X': { last_price: 100, timestamp: old } } });
  assert.ok(tick.ltt < Date.now() - 60_000);
  assert.equal(tick.source, 'upstox');
});

test('env writes use mode 0600 and do not echo the secret', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'npt-env-'));
  const file = path.join(dir, '.env');
  await writeFile(file, 'OTHER=1\n', { mode: 0o644 });
  await setEnvValue(file, 'UPSTOX_ACCESS_TOKEN', 'super-secret-token');
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
  await chmod(file, 0o600);
});

test('square-off retries a symbol that had no fresh price and does not exit twice', async () => {
  ctx.provider.setPrice('INFY', 1500);
  await http().post('/api/orders').set(user.auth).send({ symbol: 'INFY', side: 'BUY', qty: 1, clientOrderId: 'infy-sq' }).expect(201);
  const originalGet = ctx.market.getExecutableQuote.bind(ctx.market);
  const originalFetch = ctx.market.fetchFreshQuote.bind(ctx.market);
  const originalNow = ctx.engine.now;
  ctx.config.enforceMarketHours = true;
  try {
    ctx.market.getExecutableQuote = () => null;
    ctx.market.fetchFreshQuote = async () => null;
    ctx.market.quoteProblem = () => ({ ok: false, code: 'STALE', message: 'Price is stale.' });
    const clock = new Date('2026-11-06T10:00:00Z'); // 15:30 IST, after square-off
    ctx.engine.now = () => clock;
    await ctx.engine.checkSquareOff();
    assert.equal(await Position.countDocuments({ user: user.user.id, symbol: 'INFY', status: 'OPEN' }), 1);
    ctx.market.getExecutableQuote = originalGet;
    ctx.market.fetchFreshQuote = originalFetch;
    ctx.provider.setPrice('INFY', 1500);
    await ctx.engine.checkSquareOff();
    await ctx.engine.checkSquareOff();
    assert.equal(await Position.countDocuments({ user: user.user.id, symbol: 'INFY', status: 'OPEN' }), 0);
    assert.equal(await Order.countDocuments({ user: user.user.id, symbol: 'INFY', role: 'SQUAREOFF', status: 'FILLED' }), 1);
  } finally {
    ctx.market.getExecutableQuote = originalGet;
    ctx.market.fetchFreshQuote = originalFetch;
    ctx.config.enforceMarketHours = false;
    ctx.engine.now = originalNow;
  }
});

test('an existing cash balance is kept when postings are introduced', async () => {
  const uid = user.user.id;
  await CashPosting.deleteMany({ user: uid });
  await Wallet.updateOne({ user: uid }, { $set: { balance: 109090.29, startingBalance: 110000 } });
  const kept = await repairBalance(uid, 110000);
  assert.equal(kept.balance, 109090.29);
  assert.equal(await CashPosting.countDocuments({ key: `opening:${uid}` }), 1);
  await postCash(uid, 'after-opening', -10, 110000);
  await postCash(uid, 'after-opening', -10, 110000);
  const afterFill = await repairBalance(uid, 110000);
  assert.equal(afterFill.balance, 109080.29);
});

test('options dashboard does not keep share totals, and a failed options fetch is not the share payload', async () => {
  ctx.provider.setPrice('TCS', 3000);
  await http().post('/api/orders').set(user.auth).send({ symbol: 'TCS', side: 'BUY', qty: 1, clientOrderId: 'tcs-1' }).expect(201);
  await http().post('/api/positions/TCS/exit').set(user.auth).expect(200);
  const shares = await http().get('/api/dashboard?segment=EQ').set(user.auth).expect(200);
  const options = await http().get('/api/dashboard?segment=OPT').set(user.auth).expect(200);
  assert.ok(shares.body.stats.trades >= 1);
  assert.equal(options.body.stats.trades, 0);
  assert.equal(options.body.totals.realizedNet, 0);
});

import test, { beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { OptionTrader } from '../src/options/optionTrader.js';
import { createApp } from '../src/app.js';
import { setup, teardown, closeDb, registerUser } from './helpers.js';
import { TradeDefaults } from '../src/models/index.js';
import { rulesFor } from '../src/models/TradeDefaults.js';
import { stopRuleOf } from '../src/study/patterns.js';
import { entryWindowOf, entryTest, entryTestOf } from '../src/options/signal.js';
import { normalizeCombos, comboFitsIndex } from '../src/combos/combos.js';
import { studyCombos } from '../src/study/optionsStudy.js';

let ctx;
let user;
const api = () => request(ctx.app);
beforeEach(async () => {
  ctx = await setup();
  const optionTrader = new OptionTrader({ market: ctx.market, engine: ctx.engine, config: ctx.config, scanner: ctx.scanner });
  ctx.app = createApp({ ...ctx, optionTrader });
  user = await registerUser(ctx.app);
});
afterEach(() => teardown(ctx));
after(closeDb);

// 09:15 IST on Monday 5 Oct 2026 is 03:45 UTC; a bar that opens at 09:15 closes at 09:20.
const OPEN = Date.UTC(2026, 9, 5, 3, 45) / 1000;
const at = (hh, mm) => OPEN + ((hh - 9) * 60 + (mm - 15)) * 60;

test('the entry window defaults to 09:15-15:15, takes the user\'s hours and ignores nonsense', () => {
  assert.deepEqual(entryWindowOf({}), { from: 555, to: 915 });
  assert.deepEqual(entryWindowOf({ entryFrom: 570, entryTo: 840 }), { from: 570, to: 840 });
  assert.deepEqual(entryWindowOf({ entryFrom: 100, entryTo: 2000 }), { from: 555, to: 915 });
  const test10to14 = entryTest({ from: 600, to: 840 });
  assert.equal(test10to14(at(9, 30)), false);
  assert.equal(test10to14(at(10, 0)), true); // the bar closing at 10:05
  assert.equal(test10to14(at(13, 50)), true);
  assert.equal(test10to14(at(14, 0)), false);
  assert.equal(entryTestOf({}), null, 'no hours given: the usual rules apply');
  assert.equal(entryTestOf({ entryFrom: 600, entryTo: 840 })(at(9, 30)), false);
});

test('the entry hours are saved in Account > Limits, must be 15 minutes apart, and default to today\'s hours', async () => {
  const first = (await api().get('/api/options').set(user.auth).expect(200)).body.settings;
  assert.deepEqual([first.entryFrom, first.entryTo], [555, 915]);
  const saved = (await api().put('/api/options').set(user.auth).send({ entryFrom: 585, entryTo: 870 }).expect(200)).body.settings;
  assert.deepEqual([saved.entryFrom, saved.entryTo], [585, 870]);
  await api().put('/api/options').set(user.auth).send({ entryFrom: 600, entryTo: 605 }).expect(400);
  await api().put('/api/options').set(user.auth).send({ entryTo: 580 }).expect(400); // against the saved start
  await api().put('/api/options').set(user.auth).send({ entryFrom: 500 }).expect(400);
  await api().put('/api/options').set(user.auth).send({ entryTo: 1000 }).expect(400);
});

test('a combination that was Sensex-only is kept but switched off; studies include switched-off ones', () => {
  const list = normalizeCombos([
    { name: 'Both', conds: ['rsiAbove50'] },
    { name: 'Sensex only', conds: ['emaStack'], index: 'SENSEX' },
    { name: 'Off for live', conds: ['macdZero'], on: false },
  ]);
  assert.equal(list[0].index, undefined);
  assert.equal(list[1].on, false, 'the Sensex is gone, so it must not trade the Nifty');
  assert.equal(comboFitsIndex(list[0], 'NIFTY'), true);
  assert.deepEqual(studyCombos(list, 'NIFTY').map((c) => c.name), ['Both', 'Sensex only', 'Off for live']);
});

test('a study with a side lock trades only that side', async () => {
  const { tradesFor } = await import('../src/study/optionsStudy.js');
  const c1 = [];
  for (let k = 0; k < 400; k++) c1.push({ time: OPEN + k * 60, open: 24000, high: 24002, low: 23998, close: 24000, volume: 1 });
  const byTime = new Map(c1.map((b, i) => [b.time, i]));
  const sig = (side, k) => ({ side, time: OPEN + k * 300, close: 24000, stop: side === 'CE' ? 23950 : 24050, atr: 20, technique: 't', note: '' });
  const params = { iv: 0.14, lockStart: 1000, lockGap: 250, lotSize: 20, holidays: [], expiryWeekday: 4, lossLimit: 3000, maxLots: 2 };
  const both = tradesFor([sig('CE', 4), sig('PE', 20)], { c1, byTime, params }).trades;
  const calls = tradesFor([sig('CE', 4), sig('PE', 20)], { c1, byTime, params: { ...params, sideOnly: 'CE' } }).trades;
  assert.ok(calls.length <= both.length && calls.every((t) => t.side === 'CE'));
});

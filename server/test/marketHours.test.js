import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketStatus, istParts } from '../src/market/marketHours.js';

// 2026-10-21 is a Wednesday. IST = UTC + 5:30.
const at = (utc) => new Date(utc);

test('converts to IST wall clock', () => {
  const p = istParts(at('2026-10-21T03:45:00Z'));
  assert.equal(p.dateKey, '2026-10-21');
  assert.equal(p.minutes, 9 * 60 + 15);
});

test('open between 09:15 and 15:30 IST on a weekday', () => {
  assert.equal(getMarketStatus(at('2026-10-21T03:44:59Z')).phase, 'PRE_OPEN');
  assert.equal(getMarketStatus(at('2026-10-21T03:45:00Z')).isOpen, true);
  assert.equal(getMarketStatus(at('2026-10-21T09:59:59Z')).isOpen, true);
  assert.equal(getMarketStatus(at('2026-10-21T10:00:00Z')).phase, 'CLOSED');
});

test('square-off flag from 15:15 IST', () => {
  assert.equal(getMarketStatus(at('2026-10-21T09:44:00Z')).afterSquareOff, false);
  assert.equal(getMarketStatus(at('2026-10-21T09:45:00Z')).afterSquareOff, true);
});

test('weekends and configured holidays are closed', () => {
  assert.equal(getMarketStatus(at('2026-10-24T05:00:00Z')).phase, 'WEEKEND'); // Saturday
  const s = getMarketStatus(at('2026-10-21T05:00:00Z'), ['2026-10-21']);
  assert.equal(s.phase, 'HOLIDAY');
  assert.equal(s.isOpen, false);
});

test('IST date rolls over at 18:30 UTC', () => {
  assert.equal(istParts(at('2026-10-21T18:29:00Z')).dateKey, '2026-10-21');
  assert.equal(istParts(at('2026-10-21T18:30:00Z')).dateKey, '2026-10-22');
});

test('the report day is the last day the market was open', async () => {
  const { lastTradingDayKey } = await import('../src/market/marketHours.js');
  // Wed 2026-11-04 01:54 IST: the market has not opened yet, so the report shows Tue 3 Nov.
  assert.equal(lastTradingDayKey(at('2026-11-03T20:24:00Z')), '2026-11-03');
  // Wed 2026-11-04 10:00 IST: today.
  assert.equal(lastTradingDayKey(at('2026-11-04T04:30:00Z')), '2026-11-04');
  // Sat 2026-11-07 and Mon 2026-11-09 08:00 IST both go back to Fri 6 Nov.
  assert.equal(lastTradingDayKey(at('2026-11-07T06:00:00Z')), '2026-11-06');
  assert.equal(lastTradingDayKey(at('2026-11-09T02:30:00Z')), '2026-11-06');
  // a holiday is skipped too
  assert.equal(lastTradingDayKey(at('2026-11-04T04:30:00Z'), ['2026-11-04']), '2026-11-03');
});

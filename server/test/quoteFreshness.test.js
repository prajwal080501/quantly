import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuote, feedAuth, parseUpstreamTime } from '../src/market/quoteFreshness.js';
import { getMarketStatus } from '../src/market/marketHours.js';

const now = 1_700_000_000_000;

test('a last-trade time older than the window is stale even if the packet just arrived', () => {
  const verdict = assessQuote(
    { ltp: 100, ltt: now - 60_000, feedTs: now, source: 'upstox' },
    { now, maxAgeMs: 15_000 },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'STALE');
});

test('the same upstream timestamp may repeat; an older one is out of order', () => {
  const same = assessQuote({ ltp: 100, ltt: now - 1000, source: 'upstox' }, { now, lastAcceptedTs: now - 1000 });
  assert.equal(same.ok, true);
  const older = assessQuote({ ltp: 100, ltt: now - 2000, source: 'upstox' }, { now, lastAcceptedTs: now - 1000 });
  assert.equal(older.code, 'OUT_OF_ORDER');
});

test('a missing upstream timestamp is not replaced with the local clock', () => {
  const verdict = assessQuote({ ltp: 100, source: 'upstox', ts: now }, { now });
  assert.equal(verdict.code, 'NO_TIMESTAMP');
});

test('a fresh feed-message time without a last-trade time is not an executable quote', () => {
  const verdict = assessQuote({ ltp: 100, feedTs: now, source: 'upstox' }, { now });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'NO_TIMESTAMP');
});

test('a future timestamp and a non-positive price are rejected', () => {
  assert.equal(assessQuote({ ltp: 100, ltt: now + 30_000, source: 'upstox' }, { now }).code, 'FUTURE');
  assert.equal(assessQuote({ ltp: 0, ltt: now, source: 'upstox' }, { now }).code, 'NO_PRICE');
});

test('mock prices are executable only when the caller allows the mock provider', () => {
  const tick = { ltp: 100, ts: now, source: 'mock' };
  assert.equal(assessQuote(tick, { now }).code, 'MOCK_NOT_ALLOWED');
  assert.equal(assessQuote(tick, { now, allowMock: true }).ok, true);
});

test('feed auth is expired only when the message says the token failed, without calling Upstox', () => {
  assert.equal(feedAuth('Connected to Upstox feed', true), 'ok');
  assert.equal(feedAuth('Feed offline: Upstox access token is invalid or expired (they expire around 03:30 IST daily)', false), 'expired');
  assert.equal(feedAuth('HTTP 401', false), 'expired');
  assert.equal(feedAuth('Upstox feed disconnected', false), 'disconnected');
  assert.equal(feedAuth('', false), 'unknown');
});

test('a Saturday is a weekend even when NSE_HOLIDAYS is empty', () => {
  const status = getMarketStatus(new Date('2026-11-07T05:00:00Z'), []);
  assert.equal(status.phase, 'WEEKEND');
  assert.equal(status.isOpen, false);
  assert.equal(status.tradingDay, false);
});

test('naive Upstox quote strings are parsed as IST', () => {
  const t = parseUpstreamTime('2026-11-06T15:15:00');
  assert.equal(new Date(t).toISOString(), '2026-11-06T09:45:00.000Z');
  assert.equal(parseUpstreamTime(''), null);
});

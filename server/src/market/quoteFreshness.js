// Whether a quote may be used for a paper fill or a new entry.
// An upstream timestamp that is old is stale even if this process just received the packet.
// `Date.now()` is never a substitute for a missing exchange or feed timestamp.

export const DEFAULT_MAX_AGE_MS = 15_000;
export const DEFAULT_FUTURE_SKEW_MS = 5_000;

/** Classify a feed status message. Does not contact Upstox. */
export function feedAuth(message, connected) {
  const text = String(message || '');
  if (/401|invalid or expired|access token/i.test(text)) return 'expired';
  if (connected) return 'ok';
  if (!text) return 'unknown';
  return 'disconnected';
}

const finiteMs = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {object} tick ltp plus ltt (exchange last-trade time, ms), feedTs (provider message time, ms), source
 * @param {{ now?: number, maxAgeMs?: number, futureSkewMs?: number, lastAcceptedTs?: number|null, allowMock?: boolean }} [opts]
 */
export function assessQuote(tick, opts = {}) {
  const now = opts.now ?? Date.now();
  // The mock feed's timestamp is the moment the test or simulator set the price. It is not an exchange clock.
  const maxAge = opts.maxAgeMs ?? (tick?.source === 'mock' ? 24 * 60 * 60 * 1000 : DEFAULT_MAX_AGE_MS);
  const skew = opts.futureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  if (!tick || !(Number(tick.ltp) > 0) || !Number.isFinite(Number(tick.ltp))) {
    return { ok: false, code: 'NO_PRICE', message: 'No price from the feed.' };
  }
  if (tick.source === 'mock') {
    if (!opts.allowMock) return { ok: false, code: 'MOCK_NOT_ALLOWED', message: 'Simulated prices are not used unless the mock feed is the configured provider.' };
  } else if (tick.source !== 'upstox') {
    return { ok: false, code: 'UNKNOWN_SOURCE', message: 'Price did not come from the configured market-data feed.' };
  }

  const ltt = finiteMs(tick.ltt);
  const feedTs = finiteMs(tick.feedTs);
  let stamp = null;
  let kind = null;
  if (tick.source === 'mock') {
    stamp = finiteMs(tick.ts);
    kind = 'mock';
    if (stamp == null) return { ok: false, code: 'NO_TIMESTAMP', message: 'Simulated tick has no timestamp.' };
  } else if (ltt != null) {
    // Last-trade time is the clock of the price itself. A fresh packet carrying an old ltt is not a fresh trade.
    stamp = ltt;
    kind = 'ltt';
  } else if (feedTs != null) {
    stamp = feedTs;
    kind = 'feed';
  } else {
    return { ok: false, code: 'NO_TIMESTAMP', message: 'The feed did not send an exchange or feed timestamp.' };
  }

  const ageMs = now - stamp;
  if (ageMs > maxAge) {
    return { ok: false, code: 'STALE', message: `Price is ${Math.round(ageMs / 1000)}s old and cannot be used.`, ageMs, ts: stamp, kind };
  }
  if (stamp - now > skew) {
    return { ok: false, code: 'FUTURE', message: 'Price timestamp is ahead of the clock.', ageMs, ts: stamp, kind };
  }
  if (opts.lastAcceptedTs != null && stamp < opts.lastAcceptedTs) {
    return { ok: false, code: 'OUT_OF_ORDER', message: 'Price timestamp is older than the last accepted one.', ageMs, ts: stamp, kind };
  }
  return { ok: true, code: 'FRESH', message: 'Fresh price.', ageMs, ts: stamp, kind, ltp: Number(tick.ltp) };
}

/** Parse an Upstox quote time. Naive strings are exchange-local IST, not UTC and not "now". */
export function parseUpstreamTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const t = Date.parse(text);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(`${text.replace(' ', 'T')}+05:30`);
  return Number.isFinite(t) ? t : null;
}

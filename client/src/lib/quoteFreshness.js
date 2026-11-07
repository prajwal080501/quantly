// Keep in step with server/src/market/quoteFreshness.js. The UI must not present an old tick as live.

export const MAX_QUOTE_AGE_MS = 15_000;

export function quoteView(tick, now = Date.now()) {
  if (!tick || !(Number(tick.ltp) > 0)) {
    return { state: 'unavailable', label: 'Price unavailable', ltp: null, ts: null, source: tick?.source || null };
  }
  const ts = Number(tick.ltt || tick.feedTs || (tick.source === 'mock' ? tick.ts : NaN));
  if (!Number.isFinite(ts) || ts <= 0) {
    return { state: 'unavailable', label: 'No timestamp', ltp: null, ts: null, source: tick.source || null };
  }
  const age = now - ts;
  if (age > MAX_QUOTE_AGE_MS || ts - now > 5_000) {
    return { state: 'stale', label: age > 0 ? `Stale ${Math.round(age / 1000)}s` : 'Clock skew', ltp: Number(tick.ltp), ts, source: tick.source || null };
  }
  const when = new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const source = tick.source === 'mock' ? 'Simulated' : tick.source === 'upstox' ? 'Upstox' : tick.source || 'Feed';
  return { state: 'fresh', label: `${source} ${when} IST`, ltp: Number(tick.ltp), ts, source: tick.source || null };
}

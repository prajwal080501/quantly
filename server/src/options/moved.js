import { aggregateCandles } from '../market/providers/BaseProvider.js';
import { rsi } from '../signals/indicators.js';
import { istParts } from '../market/marketHours.js';

// The "already moved" check: do not buy a call after the index has already run up (or a put after it has already fallen) a long way.
// 3 Nov 2026: a 23700 CE was bought at 13:31 after the Nifty had run up and the premium had gone from about 175 to 203.8; the move was spent and it ended -₹3,133.
// The premium side of this is the anti-chase check (chase.js). This file looks at the index itself. The live trader and the replays call the
// same `movedMeasures`, so a limit picked in the "Already moved" tester means the same thing live.

const IST = 19800;
const istDay = (t) => Math.floor((t + IST) / 86400);
const LOOKBACK_BARS = 420; // 1-minute bars read before the moment: enough for a 5-minute RSI(14) to settle and for the day so far

/** The checks the user can pick from, one at a time. `value` in every measure is "in the trade's direction": up for a call, down for a put. */
export const MOVED_CHECKS = [
  { key: 'run30', label: 'Run from the 30-minute low', short: 'from its 30-minute low', unit: '%', choices: [0.15, 0.2, 0.25, 0.3, 0.4, 0.5] },
  { key: 'run60', label: 'Run from the 60-minute low', short: 'from its 60-minute low', unit: '%', choices: [0.2, 0.25, 0.3, 0.4, 0.5, 0.6] },
  { key: 'day', label: 'Move since the day open', short: 'since the day open', unit: '%', choices: [0.2, 0.3, 0.4, 0.5, 0.7, 0.9] },
  { key: 'stretch', label: 'Stretch from the day average', short: 'from the day average price', unit: 'ATR', choices: [1, 1.5, 2, 2.5, 3, 4] },
  { key: 'rsi', label: 'RSI already stretched', short: 'RSI (5-minute)', unit: 'RSI', choices: [60, 65, 70, 75, 80] },
];
export const MOVED_KEYS = MOVED_CHECKS.map((c) => c.key);
const CHECK = new Map(MOVED_CHECKS.map((c) => [c.key, c]));

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * How far the index had already gone in the trade's direction just before `now` (epoch seconds), from the 1-minute `bars` that closed before it
 * (oldest first) and the price now.
 *  run30 / run60: % from the lowest low (call) or highest high (put) of the last 30 / 60 minutes of today
 *  day:           % from today's first open
 *  stretch:       distance from the day's average price (high+low+close / 3 of each minute, the index has no volume for a VWAP), in 5-minute ATRs
 *  rsi:           the 5-minute RSI(14) for a call, 100 minus it for a put (so 75 means "stretched in the trade's direction" for both)
 * A measure that cannot be worked out yet (the first minutes of the day) is null, and a null never blocks.
 */
export function movedMeasures(bars, { price, now, side, atr = null }) {
  const d = side === 'PE' ? -1 : 1;
  if (!(price > 0) || !Array.isArray(bars) || !bars.length) return { run30: null, run60: null, day: null, stretch: null, rsi: null, points: null };
  const day = istDay(now);
  const done = bars.filter((b) => b && b.time < now).slice(-LOOKBACK_BARS);
  const today = done.filter((b) => istDay(b.time) === day);
  const runFrom = (minutes) => {
    const xs = today.filter((b) => b.time >= now - minutes * 60);
    if (!xs.length) return null;
    const far = d > 0 ? Math.min(...xs.map((b) => b.low)) : Math.max(...xs.map((b) => b.high));
    return { pct: r2(((d * (price - far)) / far) * 100), points: r2(d * (price - far)) };
  };
  const run30 = runFrom(30);
  const run60 = runFrom(60);
  const open = today[0]?.open;
  const mean = today.length ? today.reduce((s, b) => s + (b.high + b.low + b.close) / 3, 0) / today.length : null;
  const c5 = aggregateCandles(done.map((b) => ({ ...b, volume: b.volume ?? 0 })), '5m').filter((b) => b.time + 300 <= now);
  const lastRsi = rsi(c5, 14).at(-1)?.value ?? null;
  return {
    run30: run30?.pct ?? null,
    run60: run60?.pct ?? null,
    day: open > 0 ? r2(((d * (price - open)) / open) * 100) : null,
    stretch: mean != null && atr > 0 ? r2((d * (price - mean)) / atr) : null,
    rsi: lastRsi == null ? null : r2(d > 0 ? lastRsi : 100 - lastRsi),
    points: { run30: run30?.points ?? null, run60: run60?.points ?? null, day: open > 0 ? r2(d * (price - open)) : null },
  };
}

/** The check a user's options settings ask for, or null when it is off: { key, limit }. */
export function movedOf(settings) {
  const key = settings?.movedCheck;
  const limit = Number(settings?.movedLimit);
  return key && CHECK.has(key) && limit > 0 ? { key, limit } : null;
}

/** Why the check skips a buy, or null. `index` is the short name for the words. */
export function movedSkip(measures, check, { side = 'CE', index = 'Nifty' } = {}) {
  if (!check || !measures) return null;
  const value = measures[check.key];
  if (value == null || !(value > check.limit)) return null;
  const c = CHECK.get(check.key);
  const up = side === 'PE' ? 'down' : 'up';
  if (check.key === 'rsi') return `the ${index} 5-minute RSI is ${side === 'PE' ? r2(100 - value) : value}, already stretched ${up} (your limit ${side === 'PE' ? `under ${100 - check.limit}` : `over ${check.limit}`})`;
  if (check.key === 'stretch') return `the ${index} is already ${value} ATR ${side === 'PE' ? 'below' : 'above'} the day average price, over the ${check.limit} ATR you allow`;
  const pts = measures.points?.[check.key];
  return `the ${index} is already ${up} ${value}%${pts != null ? ` (${Math.round(pts)} points)` : ''} ${c.short}, over the ${check.limit}% you allow`;
}

/** The words for a check, for the screens. */
export function movedWords(check) {
  if (!check) return 'Off';
  const c = CHECK.get(check.key);
  if (!c) return 'Off';
  if (check.key === 'rsi') return `Skip a call when the 5-minute RSI is over ${check.limit}, a put when it is under ${100 - check.limit}`;
  if (check.key === 'stretch') return `Skip a buy when the index is over ${check.limit} ATR past the day average price in the trade's direction`;
  return `Skip a buy when the index has already moved over ${check.limit}% ${c.short} in the trade's direction`;
}

/** Minutes after midnight IST of an epoch-second time, for the time-of-day rows. */
export const istMinutes = (time) => istParts(new Date(time * 1000)).minutes;

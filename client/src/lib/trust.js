// The trust meter: how much a win rate from a handful of trades can be believed. 100% of 4 trades says almost nothing;
// 60% of 80 trades says a lot. It uses the Wilson lower bound: the win rate you can be about 90% sure the real one is above.

const Z = 1.645; // about 90% one-sided

/** The lowest win rate (0-100) that fits `wins` of `trades` at about 90% confidence, or null with no trades. */
export function lowerWinRate(wins, trades) {
  if (!(trades > 0)) return null;
  const p = wins / trades;
  const z2 = Z * Z;
  const low = (p + z2 / (2 * trades) - Z * Math.sqrt((p * (1 - p)) / trades + z2 / (4 * trades * trades))) / (1 + z2 / trades);
  return Math.max(0, Math.round(low * 100));
}

/**
 * A plain verdict on a result: { tone, label, text }. `winRate` is 0-100; wins are worked out from it when not given.
 * Under 10 trades it is always "Too few trades"; after that the lower bound and the profit decide.
 */
export function trustOf({ trades, winRate = null, wins = null, net = null }) {
  const n = Number(trades) || 0;
  const w = wins ?? (winRate == null ? 0 : Math.round((winRate / 100) * n));
  const low = lowerWinRate(w, n);
  if (n < 10) return { tone: 'muted', label: 'Too few trades', low, text: `${n} trade${n === 1 ? '' : 's'} is luck as much as skill: even ${n ? Math.round((w / n) * 100) : 0}% wins could really be as low as ${low ?? 0}%. Wait for 10 or more before trusting it.` };
  if (net != null && net <= 0) return { tone: 'down', label: 'Not paying', low, text: `It lost money over ${n} trades.` };
  if (n >= 30 && low >= 45) return { tone: 'up', label: 'Solid', low, text: `${n} trades: the real win rate is very likely above ${low}%.` };
  if (low >= 35) return { tone: 'accent', label: 'Promising', low, text: `${n} trades: likely above ${low}% wins. Keep it on 1 lot until it has 30.` };
  return { tone: 'warn', label: 'Weak', low, text: `${n} trades, but the real win rate could be as low as ${low}%. Treat it as a maybe.` };
}

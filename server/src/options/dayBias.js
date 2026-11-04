// The "with the day" check: buy a call only when the index is above both today's open and today's average price, and a put only
// when it is below both. On 4 Nov 2026 a combination bought a put at 11:06 while Nifty was up on the day (it closed +0.28%, high +0.86%),
// and lost the full stop. The live trader and every replay (study, finder, Lab, testers) use this same sum, so a result means the same thing live.

export const DAY_BIAS_MIN_BARS = 15; // before 09:30 the open and the average say little, so the check lets the trade through

/** The check's settings ({ on: true }) when the user switched it on, else null. */
export const dayBiasOf = (settings) => (settings?.withDay ? { on: true } : null);

/**
 * Where the index stands against its day: today's open and the average close of today's 1-minute bars before `now` (epoch seconds).
 * `c1` are 1-minute bars, oldest first (other days may be included). Null when today has too few bars yet.
 */
export function dayStand(c1, { now, price }) {
  if (!Array.isArray(c1) || !(price > 0)) return null;
  const day = Math.floor((now + 19800) / 86400);
  let open = null;
  let sum = 0;
  let n = 0;
  for (const b of c1) {
    if (!b || b.time >= now || Math.floor((b.time + 19800) / 86400) !== day) continue;
    if (open == null) open = b.open;
    sum += b.close;
    n += 1;
  }
  if (n < DAY_BIAS_MIN_BARS || open == null) return null;
  const mean = sum / n;
  return { open, mean, price, up: price > open && price > mean, down: price < open && price < mean };
}

/** Why the check says no to a `side` ('CE' | 'PE') buy, or null when it lets it through (or it is off, or there is too little of today yet). */
export function dayBiasSkip(stand, bias, { side, index = 'Nifty' } = {}) {
  if (!bias || !stand) return null;
  const r = (x) => Math.round(x * 100) / 100;
  if (side === 'CE' && !stand.up) return `with the day only: ${index} ${r(stand.price)} is not above both today's open ${r(stand.open)} and today's average ${r(stand.mean)}, so no call`;
  if (side === 'PE' && !stand.down) return `with the day only: ${index} ${r(stand.price)} is not below both today's open ${r(stand.open)} and today's average ${r(stand.mean)}, so no put`;
  return null;
}

/**
 * The losing-streak pause: `trades` are one entry's (pattern or combination) closed trades of today, oldest first, each with `net`.
 * With `limit` losses in a row at the end, that entry stops for the rest of the day. 0 = off.
 */
export function streakSkip(trades, limit) {
  if (!(limit > 0) || trades.length < limit) return null;
  const tail = trades.slice(-limit);
  return tail.every((t) => t.net <= 0) ? `lost ${limit} times in a row today, so it rests until tomorrow` : null;
}

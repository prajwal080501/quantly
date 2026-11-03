// The anti-chase check: do not buy an option whose premium has already run far up from its low of the last few minutes.
// Buying after a spike is how a trade starts with the move already spent (3 Nov 2026: 23700 CE bought at 203.8 after a jump, then stopped out).
// The live trader and the replays use the same sum, so a threshold picked in the ladder tester means the same thing live.

export const CHASE_MINUTES = 15; // the default look-back
export const CHASE_CHOICES = [10, 15, 20, 25, 30, 40]; // percents the ladder tester tries

/**
 * How far `price` is above the lowest low of the candles that started in the last `minutes` minutes before `now` (epoch seconds), in percent.
 * Null when no such candle is known (the first minutes of the day, or no candles came back), so the check never blocks on missing data.
 */
export function chaseRise(candles, price, { now, minutes = CHASE_MINUTES }) {
  if (!(price > 0) || !Array.isArray(candles)) return null;
  const from = now - minutes * 60;
  let low = Infinity;
  for (const c of candles) if (c && c.time >= from && c.time < now && c.low > 0) low = Math.min(low, c.low);
  if (low === Infinity) return null;
  return Math.round((price / low - 1) * 1000) / 10;
}

/** The candles of the minutes before `time` from a Map(time -> candle) of one contract. */
export function candlesBefore(byTime, time, minutes = CHASE_MINUTES) {
  const out = [];
  for (let t = time - minutes * 60; t < time; t += 60) {
    const c = byTime.get(t);
    if (c) out.push(c);
  }
  return out;
}

/** Why the check skips a buy, or null: `chase` is { pct (0 = off), minutes }. */
export function chaseSkip(rise, chase) {
  if (!chase || !(chase.pct > 0) || rise == null || rise <= chase.pct) return null;
  return `the premium is already ${rise}% above its ${chase.minutes ?? CHASE_MINUTES}-minute low, over the ${chase.pct}% you allow`;
}

/** The anti-chase check a user's options settings ask for, or null when it is off. */
export function chaseOf(settings) {
  return Number(settings?.chasePct) > 0 ? { pct: Number(settings.chasePct), minutes: Number(settings.chaseMinutes) || CHASE_MINUTES } : null;
}

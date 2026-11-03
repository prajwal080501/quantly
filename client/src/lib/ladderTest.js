// Words for the ladder tester screen (Research > Ladder tester).

const rs = (v) => `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

/** A ladder as short lines: "+₹1,500 → keeps ₹200", and what happens above the last row. */
export function rungLines(steps) {
  if (!steps?.length) return ['No profit lock: a winner rides until the stop or the closing time.'];
  const lines = steps.map((s) => `+${rs(s.at)} → stop keeps ${rs(s.keep)}`);
  const last = steps.at(-1);
  lines.push(`above +${rs(last.at)}: ${rs(last.at - last.keep)} behind the best profit`);
  return lines;
}

/** The anti-chase setting in words. */
export function chaseWords(chase) {
  if (!chase || !(chase.pct > 0)) return 'Off: a buy is never skipped for a premium that already ran up.';
  return `On: no buy while the premium is over ${chase.pct}% above its ${chase.minutes ?? 15}-minute low.`;
}

/** The band of "how far the premium had already risen" in words. */
export function bandWords(b) {
  if (b.from == null) return `under ${b.to}%`;
  if (b.to == null) return `${b.from}% or more`;
  return `${b.from}% to ${b.to}%`;
}

/** Does a result's ladder equal the one saved now? */
export const sameSteps = (a = [], b = []) => a.length === b.length && a.every((s, i) => s.at === b[i].at && s.keep === b[i].keep);

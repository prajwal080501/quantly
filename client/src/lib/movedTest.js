// Words for the "Already moved?" tester (Research > Already moved).

const rs = (v) => `${v < 0 ? '-' : ''}₹${Math.abs(Math.round(Number(v))).toLocaleString('en-IN')}`;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const FAMILY_LABEL = {
  run30: 'Index run from its 30-minute low (high, for a put)',
  run60: 'Index run from its 60-minute low (high, for a put)',
  day: 'Index move since the day open',
  stretch: 'Index distance from the day average price, in ATRs',
  rsi: '5-minute RSI already stretched in the trade direction',
  chase15: 'Option premium above its 15-minute low',
  chase30: 'Option premium above its 30-minute low',
  late: 'Time of day',
};

export const BAND_CHOICES = [
  { value: 'run30', label: '30-min run' },
  { value: 'run60', label: '60-min run' },
  { value: 'day', label: 'Since open' },
  { value: 'stretch', label: 'From average' },
  { value: 'rsi', label: 'RSI' },
  { value: 'rise', label: 'Premium' },
  { value: 'minutes', label: 'Time' },
];

const UNIT = { run30: '%', run60: '%', day: '%', stretch: ' ATR', rsi: '', rise: '%', minutes: '' };

/** One band of the "how far had it moved" table in words. */
export function movedBandWords(key, b) {
  const v = (x) => (key === 'minutes' ? hhmm(x) : `${x}${UNIT[key]}`);
  if (b.from == null && b.to == null) return 'all';
  if (b.from == null) return key === 'minutes' ? `before ${v(b.to)}` : `under ${v(b.to)}`;
  if (b.to == null) return key === 'minutes' ? `${v(b.from)} or later` : `${v(b.from)} or more`;
  return `${v(b.from)} to ${v(b.to)}`;
}

/** What a limit did to the "no check" trades, in one line. */
export function skippedWords(vs) {
  if (!vs?.skipped) return 'skipped nothing';
  const parts = [`skipped ${vs.skipped}: ${vs.badSkipped} loser${vs.badSkipped === 1 ? '' : 's'} (${rs(vs.badSkippedNet)}) and ${vs.goodSkipped} winner${vs.goodSkipped === 1 ? '' : 's'} (${rs(vs.goodSkippedNet)})`];
  if (vs.added) parts.push(`took ${vs.added} other${vs.added === 1 ? '' : 's'} instead (${rs(vs.addedNet)})`);
  return parts.join('; ');
}

/** Is this row's setting the one saved now? */
export function isApplied(row, s) {
  if (!row?.apply || !s) return false;
  return Object.entries(row.apply).every(([k, v]) => s[k] === v || (k === 'chaseMinutes' && s.chasePct === 0));
}

/** How far the move had gone at one entry, for the trade list. */
export function measureLine(t) {
  const m = t.moved;
  if (!m) return t.rise != null ? `premium +${t.rise}% from its 15-min low` : '';
  const sign = (x) => (x == null ? '–' : `${x > 0 ? '+' : ''}${x}`);
  const out = [`30-min run ${sign(m.run30)}%${m.points?.run30 != null ? ` (${Math.round(m.points.run30)} pts)` : ''}`, `since open ${sign(m.day)}%`, `RSI ${m.rsi ?? '–'}`];
  if (t.rise != null) out.push(`premium +${t.rise}%`);
  return out.join(' · ');
}

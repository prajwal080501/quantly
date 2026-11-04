// Drawing helpers for the trade replay chart (components/TradeReplay.jsx). Pure, so they are tested on their own.

/**
 * The SVG paths of a replay: the closing P&L line and the best-worst band, scaled into w x h.
 * `lines` are extra levels (the ladder start, the loss limit) that widen the scale when they are near the path.
 */
export function replayPath(minutes, { w = 340, h = 170, pad = 10, lines = [] } = {}) {
  if (!minutes?.length) return null;
  const vals = minutes.flatMap((m) => [m.best, m.worst, m.pnl]);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  const span0 = hi - lo || 1;
  for (const l of lines) if (l != null && l >= lo - span0 * 0.6 && l <= hi + span0 * 0.6) { lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const span = hi - lo || 1;
  const n = minutes.length;
  const x = (i) => (n === 1 ? w / 2 : (i / (n - 1)) * (w - 2 * pad) + pad);
  const y = (v) => pad + ((hi - v) / span) * (h - 2 * pad);
  const line = minutes.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.pnl).toFixed(1)}`).join(' ');
  const top = minutes.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.best).toFixed(1)}`).join(' ');
  const bottom = [...minutes].map((m, i) => ({ m, i })).reverse().map(({ m, i }) => `L${x(i).toFixed(1)},${y(m.worst).toFixed(1)}`).join(' ');
  const peakI = minutes.reduce((a, m, i) => (m.best > minutes[a].best ? i : a), 0);
  const troughI = minutes.reduce((a, m, i) => (m.worst < minutes[a].worst ? i : a), 0);
  return {
    line,
    band: `${top} ${bottom} Z`,
    x,
    y,
    inRange: (v) => v >= lo && v <= hi,
    peak: minutes[peakI].best > 0 ? { x: x(peakI), y: y(minutes[peakI].best) } : null,
    trough: minutes[troughI].worst < 0 ? { x: x(troughI), y: y(minutes[troughI].worst) } : null,
    indexAt: (px) => Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : ((px - pad) / (w - 2 * pad)) * (n - 1)))),
  };
}

/**
 * How much a result can be trusted: the honest range of its win rate (a 90% Wilson interval) from how many trades it has, and a verdict.
 * 6 wins out of 6 is "100%", but the true rate could easily be about 69%; 60 out of 100 is much firmer. `tried` is how many combinations were
 * compared to find it (the more, the more of the best one is luck).
 */
export function trustOf({ trades, wins, tried = 1, newerNet = null } = {}) {
  if (!(trades > 0)) return null;
  const z = 1.645;
  const p = wins / trades;
  const d = 1 + (z * z) / trades;
  const mid = (p + (z * z) / (2 * trades)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / trades + (z * z) / (4 * trades * trades))) / d;
  const low = Math.max(0, Math.round((mid - half) * 100));
  const high = Math.min(100, Math.round((mid + half) * 100));
  let level;
  if (trades < 20) level = 'low';
  else if (trades < 50 || tried > 50) level = 'medium';
  else level = 'high';
  if (newerNet != null && newerNet < 0) level = 'low';
  const reasons = [];
  reasons.push(`${wins} of ${trades} won (${Math.round(p * 100)}%). With this few trades the real win rate is probably somewhere between ${low}% and ${high}%.`);
  if (trades < 20) reasons.push('Under 20 trades is too few to judge: a run of luck looks exactly like this. Aim for 50 or more.');
  if (tried > 1) reasons.push(`It was the best of about ${tried} tried. When many are tried, the best one usually does worse later, because part of its result was luck.`);
  if (newerNet != null) reasons.push(newerNet >= 0 ? 'It also made money on the newer days it was not picked on, which is a good sign.' : 'It lost money on the newer days it was not picked on: the strongest warning there is.');
  return { level, low, high, rate: Math.round(p * 100), reasons };
}

// Helpers for the trade replay popup (components/TradeReplay.jsx).

/** "11:06" in IST from a Date, an ISO string or epoch milliseconds. */
export function replayTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const m = Math.floor((d.getTime() / 60000 + 330) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * SVG paths for the minute rows: the close line, the best-so-far line, the ladder's stop line and the high/low band, plus the y of zero
 * and of the hard stop. Null without rows.
 */
export function replayPath(rows, { width = 640, height = 180, pad = 6, hardStopPnl = null } = {}) {
  if (!rows?.length) return null;
  const vals = rows.flatMap((r) => [r.pnlHigh, r.pnlLow, r.best, r.lock ?? 0]).concat([0, hardStopPnl ?? 0]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1) {
    hi += 1;
    lo -= 1;
  }
  const n = rows.length;
  const x = (i) => pad + (n === 1 ? (width - 2 * pad) / 2 : (i * (width - 2 * pad)) / (n - 1));
  const y = (v) => pad + ((hi - v) * (height - 2 * pad)) / (hi - lo);
  const line = (get) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(r)).toFixed(1)}`).join(' ');
  const withLock = rows.map((r, i) => [i, r.lock]).filter(([, v]) => v != null);
  const lock = withLock.length ? withLock.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') : null;
  const top = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.pnlHigh).toFixed(1)}`).join(' ');
  const bottom = [...rows].map((r, i) => [i, r]).reverse().map(([i, r]) => `L${x(i).toFixed(1)},${y(r.pnlLow).toFixed(1)}`).join(' ');
  return { close: line((r) => r.pnl), best: line((r) => r.best), lock, band: `${top} ${bottom} Z`, zero: y(0), hard: hardStopPnl == null ? null : y(hardStopPnl) };
}

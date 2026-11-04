// Helpers for the trade view (minute by minute). The server does the replay; these only shape it for the screen.

/** "10:42" in IST from epoch seconds. */
export const clockOf = (sec) => (sec == null ? '—' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sec * 1000)));

/** +₹1,240 / -₹3,999: whole rupees, for the minute list where paise are noise. */
export function rupees(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const s = `₹${Math.round(Math.abs(v)).toLocaleString('en-IN')}`;
  return v > 0 ? `+${s}` : v < 0 ? `-${s}` : s;
}

/**
 * The minute list with the moments put next to the minute they happened in. `keyOnly` keeps the minutes that matter: the first five,
 * every minute with a moment, each minute where P&L crossed zero, the best and worst, and the last one.
 */
export function minuteList(minutes = [], events = [], { keyOnly = false } = {}) {
  const at = new Map();
  for (const e of events) {
    const t = e.time - (e.time % 60);
    if (!at.has(t)) at.set(t, []);
    at.get(t).push(e);
  }
  let best = null;
  let worst = null;
  for (const m of minutes) {
    if (!best || m.pnl > best.pnl) best = m;
    if (!worst || m.pnl < worst.pnl) worst = m;
  }
  return minutes
    .map((m, i) => {
      const prev = minutes[i - 1];
      const crossed = prev && Math.sign(prev.pnl) !== Math.sign(m.pnl) && m.pnl !== 0;
      const moved = prev && m.stop !== prev.stop;
      return { ...m, change: prev ? Math.round(m.pnl - prev.pnl) : null, events: at.get(m.time) ?? [], crossed, stopMoved: Boolean(moved), isBest: m === best, isWorst: m === worst };
    })
    .filter((m, i, all) => !keyOnly || i < 5 || i === all.length - 1 || m.events.length || m.crossed || m.isBest || m.isWorst || m.stopMoved);
}

/** P&L checkpoints for a one-line story: after 1, 5, 10, 15, 30, 60 minutes and at the exit. */
export function checkpoints(minutes = []) {
  const out = [];
  for (const n of [1, 5, 10, 15, 30, 60]) {
    const m = minutes.find((x) => x.min === n);
    if (m && m !== minutes.at(-1)) out.push({ label: `${n} min`, pnl: m.pnl });
  }
  if (minutes.length) out.push({ label: 'exit', pnl: minutes.at(-1).pnl });
  return out;
}

/** Scales for the chart: x by candle index, y by price, a second y for the P&L bars. */
export function chartScales(candles, { extra = [], height = 200, top = 12, bottom = 18 } = {}) {
  const prices = [...candles.flatMap((c) => [c.high, c.low]), ...extra.filter((v) => typeof v === 'number' && Number.isFinite(v))];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = (hi - lo) * 0.06 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const y = (v) => top + ((max - v) / (max - min)) * (height - top - bottom);
  return { min, max, y };
}

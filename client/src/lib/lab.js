import { formatPnl as rawPnl } from './format.js';

const formatPnl = (v) => rawPnl(Math.round(v));

export const LAB_DAYS = [
  { value: '10', label: '2 weeks' },
  { value: '22', label: '1 month' },
  { value: '44', label: '2 months' },
];

export const LAB_PRICES = [
  { value: 'mixed', label: 'Real where saved' },
  { value: 'real', label: 'Real only' },
  { value: 'estimated', label: 'Estimated' },
];

/** The request for the lab: the start, up to three added checks, how many days and which premiums. */
export function labPath({ base, add = [], days = 22, prices = 'mixed' }) {
  const q = new URLSearchParams({ base, days: String(days), prices });
  if (add.length) q.set('add', add.join(','));
  return `/lab?${q}`;
}

/** Adds or removes a check from the picks, keeping the three most recent. */
export const togglePick = (add, key, max = 3) => (add.includes(key) ? add.filter((k) => k !== key) : [...add, key].slice(-max));

/** "21 Oct 10:35" from epoch seconds, in IST. */
export function whenText(sec) {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sec * 1000));
  return d.replace(',', '');
}

export const EXIT_WORD = { STOP: 'Stop hit', LOCK: 'Profit lock', TRAIL: 'Trailing stop', BREAKEVEN: 'Break-even', TARGET: 'Target', EOD: 'Closing time', HARD: 'Hard stop' };
export const exitWord = (r) => EXIT_WORD[r] ?? r;

/** One line on what a check would have done to the entries: "skips 3 (2 losers ₹-4,100, 1 winner ₹900), adds 0". */
export function addonLine(a) {
  const r = a.removed;
  const parts = [];
  if (r.trades) parts.push(`skips ${r.trades}: ${r.losers} loser${r.losers === 1 ? '' : 's'} ${formatPnl(r.losersNet)}${r.winners ? `, ${r.winners} winner${r.winners === 1 ? '' : 's'} ${formatPnl(r.winnersNet)}` : ''}`);
  if (a.added.trades) parts.push(`adds ${a.added.trades} (${formatPnl(a.added.net)})`);
  return parts.join(' · ');
}

/** What would have skipped a losing entry, in a sentence. */
export function fixLine(f) {
  const cost = f.winnersLost ? `also skips ${f.winnersLost} winner${f.winnersLost === 1 ? '' : 's'} (${formatPnl(f.winnersLostNet)})` : 'skips no winner';
  return `${f.label}: ${cost}, net ${f.gain >= 0 ? 'better' : 'worse'} by ${formatPnl(Math.abs(f.gain)).replace(/^[+-]/, '')}`;
}

/** Chart arrows for the entries: green/red by result, grey when the picked check would have skipped it. `selected` is drawn larger. */
export function entryMarkers(entries, colors, selected = null) {
  const out = [];
  for (const e of entries) {
    const call = e.side === 'CE';
    const gone = e.status === 'removed';
    const color = gone ? colors.muted : e.net > 0 ? colors.up : colors.down;
    out.push({ id: e.id, time: e.entryTime - 300, position: call ? 'belowBar' : 'aboveBar', shape: call ? 'arrowUp' : 'arrowDown', color, size: e.id === selected ? 2 : 1, text: `${gone ? '✕ ' : e.status === 'added' ? '+ ' : ''}${Math.round(e.net)}` });
    if (e.id === selected) out.push({ id: `${e.id}:exit`, time: e.exitTime - 60, position: call ? 'aboveBar' : 'belowBar', shape: 'circle', color, text: exitWord(e.reason) });
  }
  return out;
}

/** An SVG path for an equity line: points are { time, net }; a start at zero is added. */
export function equityPath(points, { w = 320, h = 90, pad = 4, min = null, max = null } = {}) {
  if (!points?.length) return '';
  const xs = points.map((p) => p.time);
  const ys = [0, ...points.map((p) => p.net)];
  const lo = min ?? Math.min(...ys);
  const hi = max ?? Math.max(...ys);
  const x0 = Math.min(...xs);
  const dx = Math.max(Math.max(...xs) - x0, 1);
  const dy = Math.max(hi - lo, 1);
  const px = (t) => pad + ((t - x0) / dx) * (w - 2 * pad);
  const py = (v) => h - pad - ((v - lo) / dy) * (h - 2 * pad);
  return `M${px(x0).toFixed(1)},${py(0).toFixed(1)} ${points.map((p) => `L${px(p.time).toFixed(1)},${py(p.net).toFixed(1)}`).join(' ')}`;
}

/** The common vertical range of several equity lines, so two lines can be compared on one chart. */
export function equityRange(...lines) {
  const ys = [0, ...lines.flatMap((l) => (l || []).map((p) => p.net))];
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

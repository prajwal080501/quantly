import { round2 } from '../utils/money.js';
import { pnlRows } from './pnlCsv.js';

// The numbers behind the Profit & Loss screen: totals, then the same trades grouped by day, week and month, weekday, hour and symbol.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const utc = (day) => new Date(`${day}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const weekday = (day) => (utc(day).getUTCDay() + 6) % 7; // Monday = 0
const weekStart = (day) => iso(new Date(utc(day).getTime() - weekday(day) * 86400000));
const dayLabel = (day) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

function bucket(rows, keyOf, labelOf) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const b = map.get(k) ?? { key: k, label: labelOf(k), trades: 0, wins: 0, losses: 0, gross: 0, charges: 0, net: 0 };
    b.trades += 1;
    if (r.net > 0) b.wins += 1;
    else if (r.net < 0) b.losses += 1;
    b.gross += r.gross;
    b.charges += r.charges;
    b.net += r.net;
    map.set(k, b);
  }
  return [...map.values()].map((b) => ({ ...b, gross: round2(b.gross), charges: round2(b.charges), net: round2(b.net), winRate: b.trades ? Math.round((b.wins / b.trades) * 100) : null }));
}
const sorted = (xs) => xs.sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));

/** @param positions closed positions (lean), any order */
export function pnlSummary(positions) {
  const rows = pnlRows(positions).sort((a, b) => a.closed.localeCompare(b.closed));
  const wins = rows.filter((r) => r.net > 0);
  const losses = rows.filter((r) => r.net < 0);
  const sum = (xs, k = 'net') => xs.reduce((s, r) => s + r[k], 0);
  const days = sorted(bucket(rows, (r) => r.day, dayLabel));
  const weeks = sorted(bucket(rows, (r) => weekStart(r.day), (k) => `${dayLabel(k)} week`));
  const months = sorted(bucket(rows, (r) => r.day.slice(0, 7), (k) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`));

  let run = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const cumulative = days.map((d) => {
    run += d.net;
    peak = Math.max(peak, run);
    maxDrawdown = Math.max(maxDrawdown, peak - run);
    return { day: d.key, net: d.net, total: round2(run) };
  });

  let streakW = 0, streakL = 0, curW = 0, curL = 0;
  for (const r of rows) {
    if (r.net > 0) { curW += 1; curL = 0; } else if (r.net < 0) { curL += 1; curW = 0; } else { curW = 0; curL = 0; }
    streakW = Math.max(streakW, curW);
    streakL = Math.max(streakL, curL);
  }

  const grossWin = sum(wins);
  const grossLoss = -sum(losses);
  const byDay = [...days].sort((a, b) => b.net - a.net);
  const pick = (r) => (r ? { symbol: r.symbol, day: r.day, net: r.net } : null);
  const byNet = [...rows].sort((a, b) => b.net - a.net);

  const hourOf = (r) => (r.opened ? Number(r.opened.slice(11, 13)) : null);
  const symbolName = (s) => s;

  return {
    totals: {
      trades: rows.length,
      wins: wins.length,
      losses: losses.length,
      winRate: rows.length ? Math.round((wins.length / rows.length) * 100) : null,
      gross: round2(sum(rows, 'gross')),
      charges: round2(sum(rows, 'charges')),
      net: round2(sum(rows)),
      avgWin: wins.length ? round2(grossWin / wins.length) : null,
      avgLoss: losses.length ? round2(-grossLoss / losses.length) : null,
      profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : null,
      best: pick(byNet[0]),
      worst: pick(byNet.at(-1)),
      bestDay: byDay[0] ? { day: byDay[0].key, net: byDay[0].net } : null,
      worstDay: byDay.at(-1) ? { day: byDay.at(-1).key, net: byDay.at(-1).net } : null,
      winningDays: days.filter((d) => d.net > 0).length,
      losingDays: days.filter((d) => d.net < 0).length,
      maxDrawdown: round2(maxDrawdown),
      longestWinStreak: streakW,
      longestLossStreak: streakL,
    },
    periods: { day: days, week: weeks, month: months },
    cumulative,
    byWeekday: sorted(bucket(rows, (r) => weekday(r.day), (k) => WEEKDAYS[k])).filter((b) => b.key < 5 || b.trades),
    byHour: sorted(bucket(rows.filter((r) => hourOf(r) != null), (r) => hourOf(r), (k) => `${String(k).padStart(2, '0')}:00`)),
    bySegment: bucket(rows, (r) => r.segment, (k) => k),
    bySymbol: bucket(rows, (r) => r.symbol, symbolName).sort((a, b) => b.net - a.net),
  };
}

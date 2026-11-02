import { useMemo, useState } from 'react';
import { useApi } from '../lib/useApi.js';
import { formatPnl, formatCompactINR, pnlClass } from '../lib/format.js';
import { Card, Segmented, Skeleton } from './ui.jsx';

const istDay = (offset = 0) => new Date(Date.now() + 19800000 - offset * 86400000).toISOString().slice(0, 10);
const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
];

/** Green and red bars, one per period, with the zero line. Tap a bar to read it. */
function Bars({ rows, selected, onSelect }) {
  const w = 360;
  const h = 170;
  const pad = { l: 40, r: 6, t: 10, b: 22 };
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const mid = pad.t + (h - pad.t - pad.b) / 2;
  const half = (h - pad.t - pad.b) / 2;
  const slot = (w - pad.l - pad.r) / Math.max(rows.length, 1);
  const bw = Math.max(3, Math.min(28, slot * 0.7));
  const every = Math.ceil(rows.length / 6);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Profit or loss for each period">
      <line x1={pad.l} x2={w - pad.r} y1={mid} y2={mid} className="stroke-line" />
      <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" className="fill-muted text-[9px]">{formatCompactINR(max)}</text>
      <text x={pad.l - 4} y={h - pad.b} textAnchor="end" className="fill-muted text-[9px]">{formatCompactINR(-max)}</text>
      {rows.map((r, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2;
        const bh = Math.max(1.5, (Math.abs(r.net) / max) * half);
        const up = r.net >= 0;
        return (
          <g key={r.key} onClick={() => onSelect(r.key)} className="cursor-pointer">
            <rect x={pad.l + i * slot} y={pad.t} width={slot} height={h - pad.t - pad.b} fill="transparent" />
            <rect x={x} y={up ? mid - bh : mid} width={bw} height={bh} rx="2" className={up ? 'fill-up' : 'fill-down'} opacity={selected && selected !== r.key ? 0.4 : 1} />
            {i % every === 0 && <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="fill-muted text-[9px]">{r.label.replace(' week', '')}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** The running total after each day. */
function Line({ points }) {
  const w = 360;
  const h = 150;
  const pad = { l: 40, r: 8, t: 10, b: 18 };
  const vals = points.map((p) => p.total);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i) => pad.l + (points.length < 2 ? (w - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (w - pad.l - pad.r));
  const y = (v) => pad.t + (1 - (v - lo) / span) * (h - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const last = vals.at(-1) ?? 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Running profit or loss">
      <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="stroke-line" strokeDasharray="3 3" />
      <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" className="fill-muted text-[9px]">{formatCompactINR(hi)}</text>
      <text x={pad.l - 4} y={h - pad.b} textAnchor="end" className="fill-muted text-[9px]">{formatCompactINR(lo)}</text>
      <path d={`${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className={last >= 0 ? 'fill-up' : 'fill-down'} opacity="0.12" />
      <path d={path} fill="none" strokeWidth="2" strokeLinejoin="round" className={last >= 0 ? 'stroke-up' : 'stroke-down'} />
      <text x={pad.l} y={h - 4} className="fill-muted text-[9px]">{points[0]?.day.slice(5)}</text>
      <text x={w - pad.r} y={h - 4} textAnchor="end" className="fill-muted text-[9px]">{points.at(-1)?.day.slice(5)}</text>
    </svg>
  );
}

function Table({ title, rows, first = 'Period', limit }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  if (!rows.length) return null;
  return (
    <Card className="overflow-hidden">
      <h3 className="px-3 pb-1 pt-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 text-left font-medium">{first}</th>
              <th className="px-2 py-1.5 text-right font-medium">Trades</th>
              <th className="px-2 py-1.5 text-right font-medium">Won</th>
              <th className="px-2 py-1.5 text-right font-medium">Charges</th>
              <th className="px-3 py-1.5 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {shown.map((r) => (
              <tr key={r.key}>
                <td className="whitespace-nowrap px-3 py-1.5 text-left font-medium">{r.label}</td>
                <td className="px-2 py-1.5 text-right">{r.trades}</td>
                <td className="px-2 py-1.5 text-right">{r.winRate == null ? '—' : `${r.winRate}%`}</td>
                <td className="px-2 py-1.5 text-right text-muted">{Math.round(r.charges).toLocaleString('en-IN')}</td>
                <td className={`px-3 py-1.5 text-right font-semibold ${pnlClass(r.net)}`}>{formatPnl(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit && rows.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-line py-2 text-xs font-medium text-accent2">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </Card>
  );
}

/** Profit and loss by day, week and month: charts first, then tables. Lives on the P&L page. */
export function PnlPeriods({ segment, version }) {
  const [range, setRange] = useState('30');
  const [period, setPeriod] = useState('day');
  const [selected, setSelected] = useState(null);
  const q = new URLSearchParams({ segment });
  if (range !== 'all') q.set('from', istDay(Number(range)));
  const { data, loading } = useApi(`/report/pnl-summary?${q}`, [segment, range, version]);

  const rows = data?.periods?.[period] ?? [];
  const pick = rows.find((r) => r.key === selected);
  const tableRows = useMemo(() => [...rows].reverse(), [rows]);

  return (
    <div className="space-y-3">
      <Segmented className="w-full" size="sm" value={range} onChange={(v) => { setRange(v); setSelected(null); }} options={RANGES} />
      {loading && !data ? (
        <Skeleton className="h-56" />
      ) : !data || data.totals.trades === 0 ? (
        <Card className="p-4 text-center text-sm text-muted">No closed {segment === 'OPT' ? 'options' : 'share'} trades in this range.</Card>
      ) : (
        <>
          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Profit and loss by</h3>
              <Segmented size="sm" value={period} onChange={(v) => { setPeriod(v); setSelected(null); }} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
            </div>
            <Bars rows={rows} selected={selected} onSelect={(k) => setSelected((s) => (s === k ? null : k))} />
            <div className="num mt-1 min-h-[2.25rem] text-xs text-muted">
              {pick ? (
                <>
                  <span className="font-semibold text-fg">{pick.label}</span>: <span className={`font-semibold ${pnlClass(pick.net)}`}>{formatPnl(pick.net)}</span> from {pick.trades} trade{pick.trades === 1 ? '' : 's'} ({pick.wins} won, {pick.losses} lost), charges {Math.round(pick.charges)}
                </>
              ) : (
                'Tap a bar to see the numbers.'
              )}
            </div>
          </Card>

          <Card className="p-3">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Running total</h3>
              <span className="num text-[11px] text-muted">Worst fall from a peak {formatCompactINR(data.totals.maxDrawdown)}</span>
            </div>
            <Line points={data.cumulative} />
          </Card>

          <div className="grid grid-cols-2 gap-2">
            {[
              ['Winning days', `${data.totals.winningDays} of ${data.totals.winningDays + data.totals.losingDays}`],
              ['Best day', data.totals.bestDay ? formatPnl(data.totals.bestDay.net) : '—', data.totals.bestDay?.net],
              ['Worst day', data.totals.worstDay ? formatPnl(data.totals.worstDay.net) : '—', data.totals.worstDay?.net],
              ['Longest streaks', `${data.totals.longestWinStreak} won, ${data.totals.longestLossStreak} lost`],
            ].map(([label, value, tone]) => (
              <Card key={label} className="p-2.5">
                <div className="text-[11px] text-muted">{label}</div>
                <div className={`num mt-0.5 text-sm font-bold ${tone == null ? '' : pnlClass(tone)}`}>{value}</div>
              </Card>
            ))}
          </div>

          <Table title={period === 'day' ? 'Day by day' : period === 'week' ? 'Week by week' : 'Month by month'} rows={tableRows} first={period === 'day' ? 'Day' : period === 'week' ? 'Week' : 'Month'} limit={10} />
          <Table title="By weekday" rows={data.byWeekday} first="Day" />
          <Table title="By hour of entry (IST)" rows={data.byHour} first="Hour" />
          <Table title="By symbol" rows={data.bySymbol} first="Symbol" limit={8} />
        </>
      )}
    </div>
  );
}

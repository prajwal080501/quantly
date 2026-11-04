import { useState } from 'react';
import { useApi } from '../lib/useApi.js';
import { formatPnl as rawPnl, formatPrice, pnlClass } from '../lib/format.js';
import { EXIT_LABEL } from '../lib/options.js';
import { replayPath, replayTime } from '../lib/replay.js';
import { Badge, Sheet, Skeleton } from './ui.jsx';

const formatPnl = (v) => (v == null ? '—' : rawPnl(Math.round(v)));
const TONE = { up: 'text-up', down: 'text-down', warn: 'text-warn', muted: 'text-muted' };

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num whitespace-nowrap text-sm font-bold ${tone}`}>{value}</div>
      {sub && <div className="num text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

/** The profit or loss of each minute as a line, with the best so far (dashed), where the ladder kept the stop (green) and the hard stop (red). */
function PnlChart({ rows, hardStopPnl }) {
  const W = 640;
  const H = 180;
  const P = 6;
  const path = replayPath(rows, { width: W, height: H, pad: P, hardStopPnl });
  if (!path) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Profit or loss minute by minute">
      <line x1={P} x2={W - P} y1={path.zero} y2={path.zero} className="stroke-line" strokeWidth="1" />
      {path.hard != null && <line x1={P} x2={W - P} y1={path.hard} y2={path.hard} stroke="var(--color-down)" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" />}
      <path d={path.band} fill="var(--color-accent)" opacity="0.12" />
      <path d={path.best} fill="none" stroke="var(--color-muted)" strokeDasharray="3 3" strokeWidth="1.2" />
      {path.lock && <path d={path.lock} fill="none" stroke="var(--color-up)" strokeWidth="1.5" />}
      <path d={path.close} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
    </svg>
  );
}

/**
 * Trade replay: one share or option trade minute by minute (what it was worth at each minute's close, the best and worst inside it,
 * where the ladder kept the stop), how it was entered (which pattern or combination, the score, the stops) and why it ended as it did.
 * `id` is the position id.
 */
export function TradeReplay({ id, onClose }) {
  const { data, loading, error } = useApi(id ? `/replay/${id}` : null, [id]);
  const [all, setAll] = useState(false);
  const p = data?.position;
  const e = data?.entry;
  const rows = data?.rows || [];
  const shown = all ? rows : rows.slice(0, 30);
  return (
    <Sheet title={p ? `Replay · ${p.label}` : 'Trade replay'} subtitle={p ? `${p.direction === 'LONG' ? 'Bought' : 'Sold'} ${p.qty} at ${formatPrice(p.entry)} · held ${p.minutes} min` : 'Minute by minute'} onClose={onClose}>
      {loading && !data && <Skeleton className="mt-3 h-64 w-full" />}
      {error && <p className="mt-3 text-sm text-down">{error.message}</p>}
      {p && (
        <div className="space-y-4 pb-2 pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Net" value={formatPnl(p.net)} tone={pnlClass(p.net)} sub={`charges ₹${formatPrice(p.charges)}`} />
            <Stat label="Entry → exit" value={`${formatPrice(p.entry)} → ${p.exit == null ? 'open' : formatPrice(p.exit)}`} sub={`${replayTime(p.openedAt)} → ${p.closedAt ? replayTime(p.closedAt) : 'now'}`} />
            <Stat label="Best" value={formatPnl(rows.length ? Math.max(...rows.map((r) => r.pnlHigh)) : null)} tone="text-up" sub="inside a minute" />
            <Stat label="Worst" value={formatPnl(rows.length ? Math.min(...rows.map((r) => r.pnlLow)) : null)} tone="text-down" sub={data.hardStopPnl != null ? `hard stop ${formatPnl(data.hardStopPnl)}` : 'no hard stop'} />
          </div>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Why it ended like this</h4>
            <ul className="space-y-1.5 text-xs leading-relaxed">
              {data.diagnosis.map((d, i) => (
                <li key={i} className={TONE[d.tone] || 'text-muted'}>
                  {d.text}
                </li>
              ))}
            </ul>
          </section>

          {rows.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-sm font-semibold">Profit or loss, minute by minute</h4>
              <PnlChart rows={rows} hardStopPnl={data.hardStopPnl} />
              <p className="text-[11px] text-muted">Blue: at each minute's close. Shaded: the best and worst inside the minute. Dashed: the best so far. Green: where your profit ladder kept the stop. Red dashed: the hard stop.</p>
            </section>
          )}

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">How it was entered</h4>
            {e ? (
              <div className="space-y-1.5 text-xs text-muted">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="accent">{e.source === 'manual' ? 'Bought by hand' : 'Automatic'}</Badge>
                  {e.setup && <Badge tone="muted">{e.setup}</Badge>}
                  {e.score != null && <Badge tone="muted">score {Math.round(e.score)}</Badge>}
                  {e.probation && <Badge tone="warn">1 lot: new combination</Badge>}
                  {e.outcome?.exitReason && <Badge tone={p.net > 0 ? 'up' : 'down'}>{EXIT_LABEL[e.outcome.exitReason] || e.outcome.exitReason}</Badge>}
                </div>
                <p className="num">
                  {e.lots ? `${e.lots} lot · ` : ''}
                  {e.stopLoss != null ? `hard stop ₹${formatPrice(e.stopLoss)}` : 'no hard stop'}
                  {e.stopSpot != null ? ` · chart stop at index ${formatPrice(e.stopSpot)}` : ''}
                  {e.entrySpot != null ? ` · index ${formatPrice(e.entrySpot)} at the buy` : ''}
                  {e.iv != null ? ` · IV ${e.iv}%` : ''}
                </p>
                {e.stopNote && <p>Stop: {e.stopNote}</p>}
                {data.ladder.length > 0 && <p className="num">Ladder: {data.ladder.map((r) => `+₹${Math.round(r.at)} keeps ₹${Math.round(r.keep)}`).join(' · ')}</p>}
                {e.checks?.length > 0 && (
                  <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    {e.checks.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2 py-0.5">
                        <span className="min-w-0">
                          <b className="text-fg">{c.label}:</b> {c.text}
                        </span>
                        <span className={`num shrink-0 ${c.points >= c.max ? 'text-up' : c.points > 0 ? 'text-warn' : 'text-muted'}`}>
                          {c.points}/{c.max}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted">Placed by hand from the order screen: there is no pattern or score behind it.</p>
            )}
          </section>

          {rows.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Each minute</h4>
              <div className="max-h-[50vh] overflow-auto rounded-2xl border border-line">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Min</th>
                      <th className="px-2 py-1.5 text-left">Time</th>
                      <th className="px-2 py-1.5 text-right">Price</th>
                      <th className="px-2 py-1.5 text-right">P&L</th>
                      <th className="px-2 py-1.5 text-right">Best</th>
                      <th className="px-2 py-1.5 text-right">Stop keeps</th>
                      {data.index && <th className="px-2 py-1.5 text-right">Index</th>}
                    </tr>
                  </thead>
                  <tbody className="num">
                    {shown.map((r) => (
                      <tr key={r.time} className="border-t border-line">
                        <td className="px-2 py-1">{r.minute}</td>
                        <td className="px-2 py-1">{replayTime(r.time * 1000)}</td>
                        <td className="px-2 py-1 text-right">{formatPrice(r.close)}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${pnlClass(r.pnl)}`}>{formatPnl(r.pnl)}</td>
                        <td className="px-2 py-1 text-right text-muted">{formatPnl(r.best)}</td>
                        <td className="px-2 py-1 text-right text-muted">{r.lock == null ? '—' : formatPnl(r.lock)}</td>
                        {data.index && <td className="px-2 py-1 text-right text-muted">{r.index == null ? '—' : formatPrice(r.index)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 30 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAll(!all)}>
                  {all ? 'Show the first 30 minutes' : `Show all ${rows.length} minutes`}
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}

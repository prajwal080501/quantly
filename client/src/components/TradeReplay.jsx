import { useMemo, useState } from 'react';
import { Check, X as Cross } from 'lucide-react';
import { useApi } from '../lib/useApi.js';
import { formatPnl as rawPnl, formatPrice, pnlClass } from '../lib/format.js';
import { replayPath } from '../lib/replay.js';
import { InfoButton } from './InfoButton.jsx';
import { Badge, Sheet, Skeleton } from './ui.jsx';

const formatPnl = (v) => (v == null ? '—' : rawPnl(Math.round(v)));
const ROLE = { ENTRY: 'Bought', STOPLOSS: 'Stop', TARGET: 'Target', SQUAREOFF: 'Square-off', EXIT: 'Exit' };

function Tile({ label, value, sub, tone = '' }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`num text-sm font-bold ${tone}`}>{value}</div>
      {sub && <div className="num text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

/** The profit or loss of the trade at the end of each minute it was held (the line), and its best and worst inside each minute (the band). */
function PathChart({ r, picked, onPick }) {
  const w = 340;
  const h = 170;
  const p = useMemo(() => replayPath(r.minutes, { w, h, lines: [r.lockFrom, r.limit ? -r.limit : null] }), [r]);
  if (!p) return null;
  const sel = picked != null ? r.minutes[picked] : null;
  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full touch-none select-none" role="img" aria-label="Profit and loss minute by minute"
        onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); onPick(p.indexAt(((e.clientX - b.left) / b.width) * w)); }}
        onPointerMove={(e) => { if (e.buttons !== 1) return; const b = e.currentTarget.getBoundingClientRect(); onPick(p.indexAt(((e.clientX - b.left) / b.width) * w)); }}>
        <path d={p.band} fill="var(--accent)" opacity="0.12" />
        <line x1="0" x2={w} y1={p.y(0)} y2={p.y(0)} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth="1" />
        {r.lockFrom != null && p.inRange(r.lockFrom) && (
          <>
            <line x1="0" x2={w} y1={p.y(r.lockFrom)} y2={p.y(r.lockFrom)} stroke="var(--up)" strokeDasharray="5 4" strokeWidth="1" />
            <text x="4" y={p.y(r.lockFrom) - 3} fontSize="9" fill="var(--up)">ladder starts {formatPnl(r.lockFrom)}</text>
          </>
        )}
        {r.limit > 0 && p.inRange(-r.limit) && (
          <>
            <line x1="0" x2={w} y1={p.y(-r.limit)} y2={p.y(-r.limit)} stroke="var(--down)" strokeDasharray="5 4" strokeWidth="1" />
            <text x="4" y={p.y(-r.limit) + 10} fontSize="9" fill="var(--down)">your limit {formatPnl(-r.limit)}</text>
          </>
        )}
        <path d={p.line} fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinejoin="round" />
        {p.peak && <circle cx={p.peak.x} cy={p.peak.y} r="4" fill="var(--up)" />}
        {p.trough && <circle cx={p.trough.x} cy={p.trough.y} r="4" fill="var(--down)" />}
        {sel && <line x1={p.x(picked)} x2={p.x(picked)} y1="0" y2={h} stroke="var(--accent)" strokeWidth="1" />}
      </svg>
      <div className="num min-h-4 text-[11px] text-muted">
        {sel ? (
          <>Minute {sel.minute} · {sel.clock} · <b className={pnlClass(sel.pnl)}>{formatPnl(sel.pnl)}</b> · best {formatPnl(sel.best)} · worst {formatPnl(sel.worst)} · price {formatPrice(sel.price)}{sel.indexMove != null ? ` · index ${sel.indexMove > 0 ? '+' : ''}${sel.indexMove}` : ''}</>
        ) : (
          'Drag along the line to read each minute. Green dot: best moment, red dot: worst.'
        )}
      </div>
    </div>
  );
}

function MinuteTable({ r, picked, onPick }) {
  const [all, setAll] = useState(false);
  const rows = all ? r.minutes : r.minutes.slice(0, 30);
  return (
    <div className="space-y-1">
      <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-1.5 text-left">Min</th>
              <th className="px-2 py-1.5 text-left">Time</th>
              <th className="px-2 py-1.5 text-right">P&amp;L</th>
              <th className="px-2 py-1.5 text-right">Best</th>
              <th className="px-2 py-1.5 text-right">Worst</th>
              {r.segment === 'OPT' && <th className="px-2 py-1.5 text-right">Index</th>}
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((m, i) => (
              <tr key={m.time} onClick={() => onPick(i)} className={`cursor-pointer border-t border-line ${picked === i ? 'bg-accent-soft' : ''}`}>
                <td className="px-2 py-1">{m.minute}</td>
                <td className="px-2 py-1">{m.clock}</td>
                <td className={`px-2 py-1 text-right font-semibold ${pnlClass(m.pnl)}`}>{formatPnl(m.pnl)}</td>
                <td className="px-2 py-1 text-right text-up">{formatPnl(m.best)}</td>
                <td className="px-2 py-1 text-right text-down">{formatPnl(m.worst)}</td>
                {r.segment === 'OPT' && <td className="px-2 py-1 text-right">{m.indexMove == null ? '—' : `${m.indexMove > 0 ? '+' : ''}${m.indexMove}`}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.minutes.length > 30 && <button type="button" className="btn btn-sm w-full" onClick={() => setAll((v) => !v)}>{all ? 'Show the first 30 minutes' : `Show all ${r.minutes.length} minutes`}</button>}
    </div>
  );
}

/** One trade replayed minute by minute: tap any closed trade (options or shares) to open it. */
export function TradeReplay({ id, onClose }) {
  const { data, loading, error } = useApi(id ? `/positions/${id}/replay` : null, [id]);
  const [picked, setPicked] = useState(null);
  const r = data?.replay;
  const s = r?.summary;
  return (
    <Sheet title={r ? r.label : 'Trade replay'} subtitle={r ? `${r.kind} · ${r.day} · ${r.qty} qty · ${formatPrice(r.entry)} → ${formatPrice(r.exit)}` : 'Minute by minute'} onClose={onClose}>
      <div className="space-y-3 pt-2">
        {loading && !r && <Skeleton className="h-48 w-full" />}
        {error && <p className="text-sm text-down">{error.message || 'Could not load this trade'}</p>}
        {r && (
          <>
            {s && (
              <div className="grid grid-cols-3 gap-2">
                <Tile label="Ended" value={formatPnl(s.final)} tone={pnlClass(s.final)} sub={`after ₹${s.charges} charges`} />
                <Tile label="Best" value={formatPnl(s.peak)} tone="text-up" sub={`${s.peakAt}, minute ${s.peakMinute}`} />
                <Tile label="Worst" value={formatPnl(s.trough)} tone="text-down" sub={`${s.troughAt}, minute ${s.troughMinute}`} />
                <Tile label="First minute" value={formatPnl(s.first)} tone={pnlClass(s.first)} />
                <Tile label="Gave back" value={s.gaveBack > 0 ? formatPnl(-s.gaveBack) : '—'} tone={s.gaveBack > 0 ? 'text-down' : ''} sub="from the best" />
                <Tile label="In profit" value={`${s.minutesInProfit} of ${s.minutes}`} sub="minutes" />
              </div>
            )}
            {r.lessons.length > 0 && (
              <ul className="space-y-1.5 rounded-xl bg-warn/10 p-3 text-xs leading-snug">
                {r.lessons.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
            {r.minutes.length > 0 && (
              <>
                <PathChart r={r} picked={picked} onPick={setPicked} />
                <MinuteTable r={r} picked={picked} onPick={setPicked} />
              </>
            )}

            <div className="space-y-1.5 rounded-xl border border-line p-3 text-xs">
              <div className="text-sm font-semibold">Why it was bought</div>
              {!r.why && <p className="text-muted">Bought by hand (no auto trader record), so there is no pattern behind it.</p>}
              {r.why && (
                <>
                  <p className="flex flex-wrap items-center gap-1.5">
                    <b>{r.why.source}</b> <InfoButton label={String(r.why.source).replace(/^Combination: /, '')} title={r.why.source} />
                    {r.why.score != null && <Badge>score {Math.round(r.why.score)}</Badge>}
                  </p>
                  {r.why.trigger?.kind && <p className="text-muted">Trigger: {r.why.trigger.kind}{r.why.trigger.level ? ` at ${formatPrice(r.why.trigger.level)}` : ''}.</p>}
                  {r.why.entrySpot != null && <p className="text-muted">Index at entry {formatPrice(r.why.entrySpot)}{r.why.stopSpot != null ? `, stop on the index chart ${formatPrice(r.why.stopSpot)} (${Math.abs(Math.round(r.why.entrySpot - r.why.stopSpot))} points away)` : ''}.</p>}
                  {r.why.stopNote && <p className="text-muted">{r.why.stopNote}</p>}
                  {r.why.plannedMaxLoss != null && <p className="text-muted">Planned loss at the chart stop: {formatPnl(-r.why.plannedMaxLoss)}{r.why.worstCase != null ? `; hard premium stop at ${formatPnl(-r.why.worstCase)}` : ''}.</p>}
                  {r.why.checks.length > 0 && (
                    <ul className="space-y-0.5">
                      {r.why.checks.map((c) => (
                        <li key={c.label} className="flex items-start gap-1.5">
                          {c.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-up" /> : <Cross className="mt-0.5 h-3.5 w-3.5 shrink-0 text-down" />}
                          <span>{c.label}{c.text ? <span className="text-muted"> · {c.text}</span> : null}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="space-y-1.5 rounded-xl border border-line p-3 text-xs">
              <div className="text-sm font-semibold">How it ended</div>
              {r.why?.exitWords && <p>Sold by {r.why.exitWords}.</p>}
              <ul className="num space-y-0.5 text-muted">
                {r.fills.map((f, i) => (
                  <li key={i}>{f.clock} · {ROLE[f.role] ?? f.role} · {f.side === 'BUY' ? 'buy' : 'sell'} {f.qty} at {formatPrice(f.price)}</li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] leading-snug text-muted">From the saved 1-minute candles of {r.segment === 'OPT' ? 'this contract' : 'this stock'}. "P&amp;L" is at each minute's close; best and worst are the furthest it went inside the minute. Charges are taken off only at the end.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

import { ArrowDownRight, ArrowUpRight, Check, Minus } from 'lucide-react';
import { Badge, Sheet } from './ui.jsx';
import { entryStory, exitStory, exitWord, whenText } from '../lib/lab.js';
import { formatPnl as rawPnl, formatPrice, pnlClass } from '../lib/format.js';

const formatPnl = (v) => rawPnl(Math.round(v));

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num whitespace-nowrap text-sm font-bold ${tone}`}>{value}</div>
      {sub && <div className="num text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

/**
 * The View popup for one trade of a study or the Lab: why the entry happened (each check that held and what it means),
 * what the index and the option did, and how it ended, in plain words with the numbers.
 */
export function EntrySheet({ trade: t, title, onClose }) {
  const call = t.side === 'CE';
  const held = (t.why || []).filter((w) => w.held).length;
  return (
    <Sheet title={`${call ? 'Call' : 'Put'} · ${whenText(t.entryTime)}`} subtitle={title} onClose={onClose}>
      <div className="space-y-4 pb-2 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${call ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
            {call ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />} {call ? 'Bought a call' : 'Bought a put'}
          </span>
          <Badge tone={t.net > 0 ? 'up' : 'down'}>{t.net > 0 ? 'Won' : 'Lost'} ₹{Math.abs(Math.round(t.net)).toLocaleString('en-IN')}</Badge>
          <Badge tone="muted">{exitWord(t.reason)}</Badge>
          <Badge tone={t.priced === 'real' ? 'accent' : 'muted'}>{t.priced === 'real' ? 'Real saved prices' : 'Estimated prices'}</Badge>
        </div>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Why it entered</h4>
          <p className="text-xs leading-relaxed text-muted">{entryStory(t)}</p>
          {t.why?.length > 0 && (
            <ul className="space-y-1.5">
              {t.why.map((w) => (
                <li key={w.key} className="flex items-start gap-2 rounded-2xl border border-line p-2.5">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${w.held ? 'bg-up-soft text-up' : 'bg-surface-2 text-muted'}`}>
                    {w.held ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 text-xs">
                    <span className="block font-semibold">{w.label} <span className="font-normal text-muted">{w.held ? 'held' : 'did not hold'}</span></span>
                    {w.text && <span className="block leading-snug text-muted">{w.text}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {t.why?.length > 0 && <p className="text-[11px] text-muted">{held} of {t.why.length} checks held on the 5-minute bar that gave the signal. An event (a cross, a break) counts for a few bars, so it may have happened just before.</p>}
          {!t.why?.length && t.note && <p className="rounded-2xl bg-surface-2 p-2.5 text-xs text-muted">Pattern: {t.note}</p>}
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">What happened</h4>
          <p className="text-xs leading-relaxed text-muted">{exitStory(t)}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Bought at" value={`₹${formatPrice(t.entryPremium)}`} sub={`${t.lots} lot${t.lots > 1 ? 's' : ''}, ${t.strike}`} />
            <Stat label="Sold at" value={`₹${formatPrice(t.exitPremium)}`} sub={exitWord(t.reason)} />
            <Stat label="Net" value={formatPnl(t.net)} tone={pnlClass(t.net)} sub={`after ₹${Math.round(t.charges)} charges`} />
            <Stat label="Index" value={`${formatPrice(t.entrySpot)} → ${formatPrice(t.exitSpot)}`} sub={`${t.exitSpot - t.entrySpot >= 0 ? '+' : ''}${Math.round(t.exitSpot - t.entrySpot)} pts`} />
            <Stat label="Stop on the index" value={formatPrice(t.stop)} sub={`${Math.round(Math.abs(t.entrySpot - t.stop))} pts away`} />
            <Stat label="Held" value={`${t.minutes} min`} sub={`best ${formatPnl(t.best)}, worst ${formatPnl(t.worst)}`} />
          </div>
        </section>
      </div>
    </Sheet>
  );
}

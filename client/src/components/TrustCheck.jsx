import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { trustOf } from '../lib/replay.js';
import { Sheet } from './ui.jsx';

const TONE = { low: 'bg-down/15 text-down', medium: 'bg-warn/15 text-warn', high: 'bg-up/15 text-up' };
const WORD = { low: 'Trust: low', medium: 'Trust: medium', high: 'Trust: good' };

/**
 * "Can I trust this?" next to a study, Lab or Finder result: the honest range of its win rate from the number of trades, and how much of
 * it may be luck. Tap it for the reasons. `trades`, `wins`, optional `tried` (combinations compared) and `newerNet` (net on unseen days).
 */
export function TrustCheck({ trades, wins, tried = 1, newerNet = null, className = '' }) {
  const [open, setOpen] = useState(false);
  const t = trustOf({ trades, wins, tried, newerNet });
  if (!t) return null;
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[t.level]} ${className}`} title="Can I trust this result?">
        <ShieldCheck className="h-3 w-3" /> {WORD[t.level]} · real win rate {t.low}–{t.high}%
      </button>
      {open && (
        <Sheet title="Can I trust this result?" subtitle={`${t.rate}% win on ${trades} trades`} onClose={() => setOpen(false)}>
          <div className="space-y-2 pt-2 text-sm leading-snug">
            {t.reasons.map((x) => <p key={x}>{x}</p>)}
            <p className="text-muted">Why a pattern with 100% in the study can lose live: on a few days, almost any rule can look perfect by chance. The finder also picks the best of many tries, and the best of many is the one that was luckiest. Real algo traders only trust a rule that has many trades, works on days it was not chosen on, and still pays after charges and slippage.</p>
            <p className="text-muted">What to look at instead of win rate: the average rupees per trade after charges, the worst losing run, and whether the newer days agree with the older ones.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}

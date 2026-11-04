import { useState } from 'react';
import { trustOf } from '../lib/trust.js';
import { Badge } from './ui.jsx';

/**
 * The trust meter for a result: "Too few trades", "Weak", "Promising", "Solid" or "Not paying", from how many trades it had and its
 * win rate. Tap it for the reason. `long` shows the reason under it straight away.
 */
export function TrustBadge({ trades, winRate, net = null, long = false, still = false }) {
  const [open, setOpen] = useState(long);
  if (trades == null) return null;
  const t = trustOf({ trades, winRate, net });
  if (still) return <Badge tone={t.tone}>{t.label}</Badge>; // inside another button: no tap of its own
  return (
    <span className={long ? 'block space-y-1' : 'inline'}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className="align-middle" aria-label={`Trust: ${t.label}`}>
        <Badge tone={t.tone}>{t.label}</Badge>
      </button>
      {open && <span className={`${long ? 'block' : 'ml-1'} text-[11px] font-normal normal-case text-muted`}>{t.text}</span>}
    </span>
  );
}

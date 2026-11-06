import { formatPrice } from '../lib/format.js';
import { quoteView } from '../lib/quoteFreshness.js';

/** Current price with freshness. A stale tick is not shown as a live price. */
export function LivePrice({ tick, className = '', compact = false }) {
  const view = quoteView(tick);
  if (view.state === 'fresh') {
    return (
      <span className={className} title={view.label}>
        <span className="num">{formatPrice(view.ltp)}</span>
        {!compact && <span className="mt-0.5 block text-[10px] font-normal text-muted">{view.label}</span>}
      </span>
    );
  }
  return (
    <span className={`text-muted ${className}`} title={view.label}>
      <span className="block text-xs font-medium">{view.state === 'stale' ? 'Stale' : 'Unavailable'}</span>
      {!compact && <span className="block text-[10px]">{view.label}</span>}
    </span>
  );
}

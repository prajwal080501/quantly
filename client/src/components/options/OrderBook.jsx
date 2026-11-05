import { useEffect, useState } from 'react';
import { useMarket } from '../../context/MarketContext.jsx';
import { useApi } from '../../lib/useApi.js';
import { DepthPanel } from '../DepthPanel.jsx';
import { Card, Segmented } from '../ui.jsx';

/** The live order book (five best waiting buy and sell prices) of the call or put now on offer, with a note on the one-second record. */
export function OrderBook({ contracts }) {
  const { subscribeDepth } = useMarket();
  const [side, setSide] = useState('CE');
  const symbol = contracts?.[side]?.symbol;
  const { data: rec } = useApi('/ticks', []);

  useEffect(() => (symbol ? subscribeDepth(symbol) : undefined), [symbol, subscribeDepth]);

  if (!contracts?.CE && !contracts?.PE) return null;
  const saved = rec?.saved;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Order book</h3>
        <Segmented size="sm" value={side} onChange={setSide} options={[{ value: 'CE', label: 'Call (CE)' }, { value: 'PE', label: 'Put (PE)' }]} />
      </div>
      {symbol ? <DepthPanel symbol={symbol} /> : <Card className="p-4 text-sm text-muted">No contract on offer for this side right now.</Card>}
      <p className="text-center text-[11px] text-muted">
        It shows the waiting orders at each price, not who placed them.
        {rec && (rec.recording
          ? ` Every second is being saved (${saved?.days ?? 0} of ${saved?.keeps ?? 3} days kept, ${((saved?.bytes ?? 0) / 1048576).toFixed(1)} MB); older days delete themselves.`
          : rec.simulated
            ? ' Seconds are not saved on the demo feed.'
            : ' The one-second record is off.')}
      </p>
    </div>
  );
}

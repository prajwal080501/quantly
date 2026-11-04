import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { useMarket } from '../context/MarketContext.jsx';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { useTick, useLtps } from '../lib/tickStore.js';
import { formatPrice, formatPnl, formatINR, formatTime, pnlClass } from '../lib/format.js';
import { ExitsSheet } from '../components/ExitsSheet.jsx';
import { TradeReplaySheet } from '../components/TradeReplay.jsx';
import { DataTable, Stack } from '../components/DataTable.jsx';
import { Card, Flash, Skeleton, Badge, EmptyState } from '../components/ui.jsx';

const shareClosedColumns = [
  { key: 'when', header: 'Closed', render: (p) => formatTime(p.closedAt) },
  {
    key: 'stock',
    header: 'Stock',
    render: (p) => (
      <Stack
        top={
          <span className="flex items-center gap-1.5 font-semibold">
            {p.symbol} <Badge tone={p.direction === 'LONG' ? 'up' : 'down'}>{p.direction === 'LONG' ? 'Long' : 'Short'}</Badge>
          </span>
        }
        sub={`Qty ${Math.max(p.buyQty, p.sellQty)}`}
      />
    ),
  },
  { key: 'px', header: 'Buy → Sell', align: 'right', render: (p) => `${formatPrice(p.buyQty ? p.buyValue / p.buyQty : null)} → ${formatPrice(p.sellQty ? p.sellValue / p.sellQty : null)}` },
  { key: 'net', header: 'Net', align: 'right', render: (p) => <Stack top={<span className={`font-bold ${pnlClass(p.netPnl)}`}>{formatPnl(p.netPnl)}</span>} sub={`charges ${formatINR(p.charges)}`} /> },
];

function OpenRow({ p, onExit, onEdit, busy }) {
  const t = useTick(p.symbol);
  const ltp = t?.ltp ?? p.ltp;
  const pnl = ltp != null ? (ltp - p.avgPrice) * p.netQty - p.charges + p.realizedPnl : null;
  const pct = ltp != null ? ((ltp - p.avgPrice) / p.avgPrice) * 100 * Math.sign(p.netQty) : null;
  return (
    <li className="border-b border-line px-3 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/stock/${encodeURIComponent(p.symbol)}`} className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{p.symbol}</span>
            <Badge tone={p.netQty > 0 ? 'up' : 'down'}>{p.netQty > 0 ? 'Long' : 'Short'}</Badge>
            <Badge>MIS</Badge>
            {p.stopOff && <Badge tone="down">No stop loss</Badge>}
          </div>
          <div className="num mt-1 text-xs text-muted">
            Qty {Math.abs(p.netQty)} · Avg {formatPrice(p.avgPrice)} · LTP{' '}
            <Flash value={ltp} dir={t?.dir}>
              {formatPrice(ltp)}
            </Flash>
          </div>
        </Link>
        <div className="text-right">
          <div className={`num font-bold ${pnlClass(pnl)}`}>{formatPnl(pnl)}</div>
          <div className={`num text-[11px] ${pnlClass(pct)}`}>{pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}</div>
        </div>
      </div>
      <div className="num mt-2 text-[11px] text-muted">
        {p.stopOff ? <span className="font-semibold text-down">SL OFF · floor {formatPrice(p.floor)}{p.stopLoss != null && p.stopLoss !== p.floor ? ` · lock ${formatPrice(p.stopLoss)}` : ''}</span> : `SL ${p.stopLoss != null ? formatPrice(p.stopLoss) : 'none'}`} · Target {p.target != null ? formatPrice(p.target) : 'none'}
        {p.trailPct ? ` · trailing ${p.trailPct}%` : ''}
        {p.lockSteps?.length ? ` · lock ₹${Math.round(p.lockSteps[0].keep)} at ₹${Math.round(p.lockSteps[0].at)}, ${p.lockSteps.length} rungs` : p.lockTrigger ? ` · lock ₹${p.lockAmount} at ₹${p.lockTrigger}` : ''}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => onEdit(p)} className="btn btn-secondary btn-sm">
          SL / Target
        </button>
        <button type="button" disabled={busy} onClick={() => onExit(p.symbol)} className="btn btn-secondary btn-sm">
          Exit
        </button>
      </div>
    </li>
  );
}

export default function Positions() {
  const { version, status } = useMarket();
  const today = status?.market?.istDate;
  const { data: open, loading } = useApi('/positions?status=OPEN', [version]);
  const { data: closed } = useApi(today ? `/positions?status=CLOSED&day=${today}` : null, [version]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [replay, setReplay] = useState(null);
  const { data: past } = useApi('/positions?status=CLOSED&segment=EQ', [version]);
  const earlier = (past?.positions || []).filter((p) => p.tradingDay !== today).sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).slice(0, 50);
  const positions = open?.positions || [];
  const ltpOf = useLtps(positions.map((p) => p.symbol));

  const unrealized = positions.reduce((a, p) => {
    const ltp = ltpOf(p.symbol) ?? p.ltp;
    return a + (ltp != null ? (ltp - p.avgPrice) * p.netQty : 0);
  }, 0);
  const openCosts = positions.reduce((a, p) => a + p.realizedPnl - p.charges, 0);
  const closedNet = (closed?.positions || []).reduce((a, p) => a + p.netPnl, 0);
  const dayPnl = unrealized + openCosts + closedNet;

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  const exitOne = (symbol) => run(() => api(`/positions/${encodeURIComponent(symbol)}/exit`, { method: 'POST' }));
  const exitAll = () => {
    if (window.confirm('Exit all open share positions at market and cancel their pending orders?')) run(() => api('/positions/exit-all?segment=EQ', { method: 'POST' }));
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="text-xs text-muted">Today&apos;s P&amp;L (after charges)</div>
        <div className={`num mt-1 text-3xl font-bold ${pnlClass(dayPnl)}`}>{loading ? <Skeleton className="h-9 w-40" /> : formatPnl(dayPnl)}</div>
        <div className="num mt-2 flex gap-4 text-xs text-muted">
          <span>
            Unrealised <span className={pnlClass(unrealized)}>{formatPnl(unrealized)}</span>
          </span>
          <span>
            Booked <span className={pnlClass(closedNet)}>{formatPnl(closedNet)}</span>
          </span>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Open share positions ({positions.length})</h2>
        <div className="flex items-center gap-2">
          <Link to="/orders" className="btn btn-secondary btn-sm">
            All orders
          </Link>
          {positions.length > 0 && (
            <button type="button" disabled={busy} onClick={exitAll} className="btn btn-outline-down btn-sm">
              Exit all
            </button>
          )}
        </div>
      </div>
      <Card>
        {loading ? (
          <div className="space-y-3 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : positions.length === 0 ? (
          <EmptyState icon={Briefcase} title="No open positions">
            Pick a stock from the <Link to="/" className="text-accent">watchlist</Link> to place a paper trade.
          </EmptyState>
        ) : (
          <ul>
            {positions.map((p) => (
              <OpenRow key={p._id} p={p} onExit={exitOne} onEdit={setEditing} busy={busy} />
            ))}
          </ul>
        )}
      </Card>

      {closed?.positions?.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-semibold">
            Closed today ({closed.positions.length}) <span className="text-[11px] font-normal text-muted">· tap one to replay it</span>
          </h2>
          <Card className="overflow-hidden">
            <DataTable
              onRowClick={setReplay}
              columns={shareClosedColumns}
              rows={closed.positions}
              footer={{ when: 'Day total', net: formatPnl(closedNet) }}
            />
          </Card>
        </>
      )}
      {earlier.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-semibold">
            Earlier share trades <span className="text-[11px] font-normal text-muted">· tap one to replay it minute by minute</span>
          </h2>
          <Card className="overflow-hidden">
            <DataTable onRowClick={setReplay} columns={[{ key: 'day', header: 'Day', render: (p) => <Stack top={p.tradingDay.slice(5)} sub={formatTime(p.closedAt).slice(0, 5)} /> }, ...shareClosedColumns.slice(1)]} rows={earlier} />
          </Card>
        </>
      )}
      {editing && <ExitsSheet position={editing} onClose={() => setEditing(null)} />}
      {replay && <TradeReplaySheet positionId={replay._id} title={replay.symbol} onClose={() => setReplay(null)} />}
    </div>
  );
}

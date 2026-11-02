import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarSearch, ChevronRight, Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile } from '../lib/api.js';
import { PopupTile, Segmented, Sheet } from './ui.jsx';

const istDay = (offset = 0) => new Date(Date.now() + 19800000 - offset * 86400000).toISOString().slice(0, 10);

/** Account tile that opens Day review (every call against what happened). */
export function DayReviewTile() {
  return (
    <Link to="/review" className="card-shadow flex flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-accent2">
      <CalendarSearch className="h-5 w-5 text-accent2" />
      <span className="flex w-full items-center justify-between text-sm font-semibold">
        Day review <ChevronRight className="h-4 w-4 text-muted" />
      </span>
      <span className="text-[11px] text-muted">Calls against results</span>
    </Link>
  );
}

/** Account tile: the how-to-use guide, saved as a file. */
export function GuideTile() {
  const [busy, setBusy] = useState(false);
  async function get() {
    setBusy(true);
    try {
      await downloadFile('/report/guide.md', 'app-guide.md');
      toast.success('App guide saved. Open it in any notes or text app.');
    } catch (e) {
      toast.error(e.message || 'Could not download the guide');
    } finally {
      setBusy(false);
    }
  }
  return <PopupTile icon={BookOpen} label={busy ? 'Saving…' : 'App guide'} hint="How to use, download" onClick={busy ? () => {} : get} />;
}

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Dates' },
];

/** Account tile: profit and loss as a CSV, for the days and the kind of trade you pick. */
export function PnlDownload() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState('30');
  const [from, setFrom] = useState(istDay(30));
  const [to, setTo] = useState(istDay());
  const [segment, setSegment] = useState('all');
  const [by, setBy] = useState('trade');
  const [busy, setBusy] = useState(false);
  const custom = range === 'custom';
  const bad = custom && (!from || !to || from > to);

  async function get() {
    const q = new URLSearchParams({ segment, by });
    if (custom) {
      q.set('from', from);
      q.set('to', to);
    } else if (range === 'today') {
      q.set('from', istDay());
    } else if (range !== 'all') {
      q.set('from', istDay(Number(range)));
    }
    setBusy(true);
    try {
      await downloadFile(`/report/pnl.csv?${q}`, 'profit-and-loss.csv');
      toast.success('Saved. Open it in Excel or Google Sheets.');
    } catch (e) {
      toast.error(e.message || 'Could not download');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PopupTile icon={FileSpreadsheet} label="P&L download" hint="Trades as a CSV file" onClick={() => setOpen(true)} />
      {open && (
        <Sheet title="Download profit and loss" subtitle="A spreadsheet file (CSV) of your closed trades, with charges and net profit." onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">Days</div>
              <Segmented className="w-full" size="sm" value={range} onChange={setRange} options={RANGES} />
              {custom && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-muted">From<input type="date" className="field num mt-1 !text-sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
                  <label className="text-[11px] text-muted">To<input type="date" className="field num mt-1 !text-sm" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">What</div>
              <Segmented className="w-full" size="sm" value={segment} onChange={setSegment} options={[{ value: 'all', label: 'Both' }, { value: 'OPT', label: 'Options' }, { value: 'EQ', label: 'Shares' }]} />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">Rows</div>
              <Segmented className="w-full" size="sm" value={by} onChange={setBy} options={[{ value: 'trade', label: 'One per trade' }, { value: 'day', label: 'One per day' }]} />
              <p className="text-[11px] leading-snug text-muted">{by === 'trade' ? 'Day, times, symbol, quantity, buy and sell price, profit before charges, charges, net, and a total row.' : 'Day, trades, won, lost, profit, charges, net and the running total.'}</p>
            </div>
            <button type="button" onClick={get} disabled={busy || bad} className="btn btn-primary w-full">
              <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download CSV'}
            </button>
            {bad && <p className="text-xs text-down">Pick a first date that is not after the last date.</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}

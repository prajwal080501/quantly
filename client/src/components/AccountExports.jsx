import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarSearch, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile } from '../lib/api.js';
import { PopupTile } from './ui.jsx';

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

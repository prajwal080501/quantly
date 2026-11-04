import { lazy, Suspense } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Database, FlaskConical, ClipboardCopy, Layers, Search, TrendingUp } from 'lucide-react';
import { Picker, Skeleton } from '../components/ui.jsx';

// each tab loads only when it is opened, so the Research page itself opens fast
const Lab = lazy(() => import('./Lab.jsx'));
const OptionsStudy = lazy(() => import('../components/options/OptionsStudy.jsx').then((m) => ({ default: m.OptionsStudy })));
const SharesStudy = lazy(() => import('../components/study/SharesStudy.jsx').then((m) => ({ default: m.SharesStudy })));
const FinderStudy = lazy(() => import('../components/study/FinderStudy.jsx').then((m) => ({ default: m.FinderStudy })));
const MovedTester = lazy(() => import('../components/study/MovedTester.jsx').then((m) => ({ default: m.MovedTester })));
const LadderTester = lazy(() => import('../components/study/LadderTester.jsx').then((m) => ({ default: m.LadderTester })));
const HistoryData = lazy(() => import('../components/study/HistoryData.jsx').then((m) => ({ default: m.HistoryData })));
const DayReportButton = lazy(() => import('../components/DayReportButton.jsx').then((m) => ({ default: m.DayReportButton })));

export const RESEARCH_TABS = [
  { value: 'lab', label: 'Combination Lab', icon: FlaskConical, hint: 'One combination over weeks: every entry, a chart, and the indicator that would skip each loss' },
  { value: 'options', label: 'Options study', icon: TrendingUp, hint: 'Replay past candles: which option entries pay' },
  { value: 'shares', label: 'Shares study', icon: FlaskConical, hint: 'Replay past candles: which share setups pay' },
  { value: 'ladder', label: 'Ladder tester', icon: Layers, hint: 'Your auto entries on 30 days of real option prices, sold with many profit ladders: the best one, checked on days it never saw' },
  { value: 'moved', label: 'Already moved?', icon: TrendingUp, hint: 'Do entries after the market already ran lose? Your auto entries on 30 days of real prices, with and without a limit' },
  { value: 'finder', label: 'Finder', icon: Search, hint: 'Extra checks that lift a combination, and its best stop and profit' },
  { value: 'data', label: 'Saved data', icon: Database, hint: 'The candles and option prices the other sections read' },
  { value: 'report', label: 'Day report', icon: ClipboardCopy, hint: 'Copy the day report to paste in the chat' },
];

/** Everything for trying ideas, in one place: the Combination Lab, the studies, the finder, saved data and the day report. (Day review lives in Account.) */
export default function Research() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = RESEARCH_TABS.some((t) => t.value === asked) ? asked : 'options';
  const setTab = (value) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };
  if (asked === 'review') {
    // the old address of Day review: it now lives in Account
    const rest = new URLSearchParams(params);
    rest.delete('tab');
    return <Navigate to={`/review${rest.toString() ? `?${rest}` : ''}`} replace />;
  }
  return (
    <div className="space-y-3">
      <Picker title="Research section" value={tab} onChange={setTab} options={RESEARCH_TABS} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        {tab === 'lab' && <Lab embedded />}
        {tab === 'options' && <OptionsStudy />}
        {tab === 'shares' && <SharesStudy />}
        {tab === 'finder' && <FinderStudy />}
        {tab === 'ladder' && <LadderTester />}
        {tab === 'moved' && <MovedTester />}
        {tab === 'data' && <HistoryData />}
        {tab === 'report' && <DayReportButton />}
      </Suspense>
    </div>
  );
}

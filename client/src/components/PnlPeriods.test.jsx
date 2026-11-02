import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PnlPeriods } from './PnlPeriods.jsx';

const row = (key, label, net, trades = 2) => ({ key, label, trades, wins: net > 0 ? trades : 0, losses: net > 0 ? 0 : trades, gross: net, charges: 10, net, winRate: net > 0 ? 100 : 0 });
const data = {
  totals: { trades: 4, winningDays: 1, losingDays: 1, bestDay: { day: '2026-11-02', net: 524 }, worstDay: { day: '2026-10-30', net: -4869 }, maxDrawdown: 4869, longestWinStreak: 2, longestLossStreak: 2 },
  periods: { day: [row('2026-10-30', '30 Oct', -4869), row('2026-11-02', '2 Nov', 524)], week: [row('2026-10-26', '26 Oct week', -4869), row('2026-11-02', '2 Nov week', 524)], month: [row('2026-10', 'Oct 2026', -4869), row('2026-11', 'Nov 2026', 524)] },
  cumulative: [{ day: '2026-10-30', net: -4869, total: -4869 }, { day: '2026-11-02', net: 524, total: -4345 }],
  byWeekday: [row(0, 'Mon', 524)], byHour: [row(9, '09:00', 524)], bySymbol: [row('NIFTY', 'NIFTY', 524)],
};
vi.mock('../lib/useApi.js', () => ({ useApi: () => ({ data, loading: false }) }));

describe('PnlPeriods', () => {
  it('shows the charts and tables, and switches the period', () => {
    render(<PnlPeriods segment="OPT" version={0} />);
    expect(screen.getByText('Day by day')).toBeTruthy();
    expect(screen.getAllByText('30 Oct').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Month'));
    expect(screen.getByText('Month by month')).toBeTruthy();
    expect(screen.getAllByText('Oct 2026').length).toBeGreaterThan(0);
    expect(screen.getByText('By weekday')).toBeTruthy();
    expect(screen.getByText('By hour of entry (IST)')).toBeTruthy();
  });
});

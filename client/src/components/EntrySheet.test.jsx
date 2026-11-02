import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EntrySheet } from './EntrySheet.jsx';
import { PnlDownload } from './AccountExports.jsx';

const downloadFile = vi.fn(() => Promise.resolve());
vi.mock('../lib/api.js', () => ({ downloadFile: (...a) => downloadFile(...a), api: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const trade = {
  side: 'CE', entryTime: 1762050000, exitTime: 1762051320, entrySpot: 25000, exitSpot: 25060, stop: 24970, strike: 25000, lots: 2, entryPremium: 105.95, exitPremium: 132.3,
  gross: 3425, charges: 86, net: 3339, reason: 'LOCK', minutes: 22, best: 4134, worst: -400, priced: 'real',
  why: [{ key: 'high20', label: '20-bar high broken', text: 'The close is above the highest high of the 20 bars before.', held: true }, { key: 'adxRising', label: 'ADX rising (trend getting stronger)', text: 'ADX is over 18.', held: false }],
};

describe('EntrySheet', () => {
  it('says why the entry happened, what each check means and how it ended', () => {
    const onClose = vi.fn();
    render(<EntrySheet trade={trade} title="My combination: Test" onClose={onClose} />);
    expect(screen.getByText('Bought a call')).toBeTruthy();
    expect(screen.getByText('20-bar high broken')).toBeTruthy();
    expect(screen.getByText('The close is above the highest high of the 20 bars before.')).toBeTruthy();
    expect(screen.getByText(/1 of 2 checks held/)).toBeTruthy();
    expect(screen.getByText(/Profit ladder|profit ladder/)).toBeTruthy();
    expect(screen.getAllByText(/Won/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByLabelText('Close')[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the pattern note when the trade has no list of checks', () => {
    render(<EntrySheet trade={{ ...trade, why: undefined, note: 'Breakout of the last hour', side: 'PE' }} onClose={() => {}} />);
    expect(screen.getByText(/Pattern: Breakout of the last hour/)).toBeTruthy();
    expect(screen.getByText('Bought a put')).toBeTruthy();
  });
});

describe('PnlDownload', () => {
  it('asks the server for the picked days, kind and rows', () => {
    render(<PnlDownload />);
    fireEvent.click(screen.getByText('P&L download'));
    fireEvent.click(screen.getByText('Options'));
    fireEvent.click(screen.getByText('One per day'));
    fireEvent.click(screen.getByText('Download CSV'));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const url = downloadFile.mock.calls[0][0];
    expect(url).toMatch(/^\/report\/pnl\.csv\?/);
    expect(url).toContain('segment=OPT');
    expect(url).toContain('by=day');
    expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}/);
  });
});

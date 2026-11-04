import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradeReplay } from './TradeReplay.jsx';

const replay = {
  label: 'NIFTY 24000 CE', kind: 'Call', day: '2026-11-03', qty: 130, entry: 100, exit: 76, segment: 'OPT', lockFrom: 3500, limit: 3000,
  summary: { minutes: 3, first: 130, peak: 1560, peakAt: '09:20', peakMinute: 2, trough: -3120, troughAt: '09:22', troughMinute: 3, gaveBack: 4779, minutesInProfit: 2, final: -3219, charges: 99 },
  minutes: [
    { time: 1, clock: '09:18', minute: 1, pnl: 130, best: 200, worst: 0, price: 101, indexMove: 2 },
    { time: 2, clock: '09:20', minute: 2, pnl: 1300, best: 1560, worst: 900, price: 110, indexMove: 12 },
    { time: 3, clock: '09:22', minute: 3, pnl: -3120, best: 100, worst: -3120, price: 76, indexMove: -30 },
  ],
  fills: [{ side: 'BUY', role: 'ENTRY', qty: 130, price: 100, clock: '09:18' }],
  why: { source: 'Combination: Breakout + RSI', score: 72, trigger: { kind: 'Combination: Breakout + RSI' }, checks: [{ label: 'RSI over 50', ok: true }], gates: [], exitWords: 'the stop' },
  lessons: ['It was up +₹1,560 and still ended -₹3,219.'],
};
vi.mock('../lib/useApi.js', () => ({ useApi: () => ({ data: { replay }, loading: false }) }));

describe('TradeReplay', () => {
  it('shows the end, best and worst, each minute, why it was bought and the lesson', () => {
    render(<TradeReplay id="abc" onClose={() => {}} />);
    expect(screen.getByText('NIFTY 24000 CE')).toBeTruthy();
    expect(screen.getByText('09:20, minute 2')).toBeTruthy();
    expect(screen.getByText(/still ended/)).toBeTruthy();
    expect(screen.getByText('Combination: Breakout + RSI')).toBeTruthy();
    expect(screen.getByText('RSI over 50')).toBeTruthy();
    expect(screen.getAllByText('09:22').length).toBeGreaterThan(0);
  });
});

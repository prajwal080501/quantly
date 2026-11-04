import { describe, expect, it } from 'vitest';
import { checkpoints, chartScales, minuteList, rupees } from './replay.js';

const T = 1793680800;
const minutes = [200, 600, 1000, 400, -300, -800, -1500, -1200].map((pnl, i) => ({ time: T + i * 60, min: i + 1, pnl, close: 100 + pnl / 100, stop: i < 3 ? 90 : 95 }));

describe('trade view helpers', () => {
  it('writes whole rupees with a sign', () => {
    expect(rupees(1240.4)).toBe('+₹1,240');
    expect(rupees(-3999)).toBe('-₹3,999');
    expect(rupees(0)).toBe('₹0');
    expect(rupees(null)).toBe('—');
  });

  it('puts each moment next to its minute and marks the best, the worst and the turn into loss', () => {
    const rows = minuteList(minutes, [{ time: T + 2 * 60 + 15, kind: 'peak', text: 'Best' }]);
    expect(rows).toHaveLength(8);
    expect(rows[2].events[0].kind).toBe('peak');
    expect(rows[2].isBest).toBe(true);
    expect(rows[6].isWorst).toBe(true);
    expect(rows[4].crossed).toBe(true);
    expect(rows[3].stopMoved).toBe(true);
    expect(rows[1].change).toBe(400);
  });

  it('key minutes keeps the first five, the turns, the best, the worst and the last', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ time: T + i * 60, min: i + 1, pnl: i < 30 ? 100 : -100 - i, stop: 90 }));
    const rows = minuteList(many, [], { keyOnly: true });
    expect(rows.map((r) => r.min)).toEqual([1, 2, 3, 4, 5, 31, 60]);
  });

  it('checkpoints: P&L after 1, 5 minutes and at the exit', () => {
    expect(checkpoints(minutes)).toEqual([
      { label: '1 min', pnl: 200 },
      { label: '5 min', pnl: -300 },
      { label: 'exit', pnl: -1200 },
    ]);
  });

  it('chart scale fits the candles and the stop', () => {
    const s = chartScales([{ high: 110, low: 100 }], { extra: [90, null], height: 200 });
    expect(s.min).toBeLessThan(90);
    expect(s.y(s.max)).toBeCloseTo(12);
  });
});

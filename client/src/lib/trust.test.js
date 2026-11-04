import { describe, expect, it } from 'vitest';
import { lowerWinRate, trustOf } from './trust.js';
import { replayPath, replayTime } from './replay.js';

describe('trust meter', () => {
  it('says a perfect record from a few trades is too few to trust', () => {
    const t = trustOf({ trades: 4, winRate: 100, net: 5000 });
    expect(t.label).toBe('Too few trades');
    expect(t.low).toBeLessThan(70);
  });
  it('trusts a long record more than a short one with the same win rate', () => {
    expect(lowerWinRate(48, 80)).toBeGreaterThan(lowerWinRate(6, 10));
    expect(trustOf({ trades: 80, winRate: 60, net: 9000 }).label).toBe('Solid');
    expect(trustOf({ trades: 20, winRate: 60, net: -10 }).label).toBe('Not paying');
  });
});

describe('replay helpers', () => {
  it('prints IST minutes and draws a path through every row', () => {
    expect(replayTime(Date.UTC(2026, 10, 4, 5, 36))).toBe('11:06');
    const rows = [0, 1, 2].map((i) => ({ pnl: i * 100, pnlHigh: i * 100 + 50, pnlLow: i * 100 - 50, best: i * 100 + 50, lock: i === 2 ? 100 : null }));
    const p = replayPath(rows, { hardStopPnl: -300 });
    expect(p.close.split('L').length).toBe(3);
    expect(p.lock.startsWith('M')).toBe(true);
    expect(p.hard).toBeGreaterThan(p.zero);
    expect(replayPath([])).toBeNull();
  });
});

import { withUpdated } from './autoFind.js';
describe('update a combination in place', () => {
  it('changes only that combination and keeps its name and switch', () => {
    const saved = [{ id: 'a', name: 'A', conds: ['x'], need: 1, window: 3, on: true }, { id: 'b', name: 'B', conds: ['y'], need: 1, window: 3, on: false }];
    const out = withUpdated(saved, 'a', ['x', 'z']);
    expect(out[0]).toMatchObject({ id: 'a', name: 'A', conds: ['x', 'z'], need: 2, on: true });
    expect(out[1]).toMatchObject({ id: 'b', conds: ['y'], on: false });
    expect(withUpdated(saved, 'nope', ['x'])).toBeNull();
  });
});

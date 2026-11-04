import { describe, expect, it } from 'vitest';
import { lowerWinRate, trustOf } from './trust.js';

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

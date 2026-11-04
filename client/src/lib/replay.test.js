import { describe, expect, it } from 'vitest';
import { replayPath, trustOf } from './replay.js';
import { withUpdated, updateText } from './autoFind.js';
import { conditionInfo, conditionsInLabel, findCondition } from './info.js';

describe('replayPath', () => {
  it('draws the line, the band and finds the best and worst minute', () => {
    const m = [{ pnl: 100, best: 150, worst: 0 }, { pnl: 900, best: 1200, worst: 800 }, { pnl: -2000, best: 100, worst: -2100 }];
    const p = replayPath(m, { w: 100, h: 100, pad: 0 });
    expect(p.line.startsWith('M0.0,')).toBe(true);
    expect(p.peak.x).toBe(50);
    expect(p.trough.x).toBe(100);
    expect(p.indexAt(49)).toBe(1);
    expect(p.y(1200)).toBe(0);
  });
});

describe('trustOf', () => {
  it('6 of 6 wins is not 100% for real', () => {
    const t = trustOf({ trades: 6, wins: 6 });
    expect(t.level).toBe('low');
    expect(t.low).toBe(69);
    expect(t.high).toBe(100);
  });
  it('many trades that also held on newer days earn good trust; a loss on newer days is low', () => {
    expect(trustOf({ trades: 120, wins: 70, newerNet: 5000 }).level).toBe('high');
    expect(trustOf({ trades: 120, wins: 70, newerNet: -1 }).level).toBe('low');
    expect(trustOf({ trades: 60, wins: 36, tried: 400 }).level).toBe('medium');
  });
});

describe('withUpdated', () => {
  const saved = [
    { id: 'a', name: 'Breakout + RSI', conds: ['breakout', 'rsi'], need: 2, window: 3, on: true, side: 'CE' },
    { id: 'b', name: 'Any two', conds: ['x', 'y', 'z'], need: 2, window: 3, on: false },
  ];
  it('adds the checks to an all-must-hold combination and keeps the rest', () => {
    const list = withUpdated(saved, 'a', ['ema', 'rsi']);
    expect(list[0]).toMatchObject({ id: 'a', conds: ['breakout', 'rsi', 'ema'], need: 3, on: true, side: 'CE' });
    expect(list).toHaveLength(2);
  });
  it('puts them in `also` for an any-N combination, so its rule stays', () => {
    const list = withUpdated(saved, 'b', ['ema']);
    expect(list[1]).toMatchObject({ conds: ['x', 'y', 'z'], need: 2, also: ['ema'] });
  });
  it('returns null for a combination that is gone, and explains itself', () => {
    expect(withUpdated(saved, 'zz', ['ema'])).toBeNull();
    expect(updateText(saved[0], ['EMA'])).toMatch(/stays ON/);
  });
});

describe('info', () => {
  const conds = [{ key: 'breakout', label: 'Breakout of the last hour', group: 'Chart patterns', text: 'A close above the last hour.', kind: 'event', pattern: 'breakout' }, { key: 'rsi50', label: 'RSI over 50', group: 'Momentum', text: 'RSI 14 above 50.', kind: 'state' }];
  it('finds a check by key, pattern, label, and splits a combination name', () => {
    expect(findCondition(conds, 'check:rsi50').label).toBe('RSI over 50');
    expect(findCondition(conds, 'breakout').key).toBe('breakout');
    expect(conditionsInLabel(conds, 'Combination: Breakout of the last hour + RSI over 50')).toHaveLength(2);
    const i = conditionInfo(conds[0]);
    expect(i.kind).toMatch(/An event/);
    expect(i.how).toMatch(/complete setups/);
  });
});

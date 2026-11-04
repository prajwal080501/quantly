import { describe, expect, it } from 'vitest';
import { addChecks, alreadySaved, autoFindText, changesCombo, foundName, withCopy, withFound, withUpdated } from './autoFind.js';

const f = { conds: ['p_breakout', 'ema21_rising'], labels: ['Breakout of the last hour (5m)', 'EMA 21 rising'], trades: 12, winRate: 70, net: 4000, calls: { net: 4000, trades: 12 }, puts: { net: 0, trades: 0 }, train: { trades: 8, net: 2500, winRate: 75 }, test: { trades: 4, net: 1500, winRate: 50 } };
const af = { tried: 40, trainEnd: '2026-10-10', trainDays: 20, testDays: 10, minTrain: 10, minTest: 5, baselines: [{ label: 'Breakout', conds: ['p_breakout'], train: { trades: 10, net: 100, winRate: 60 }, test: { trades: 5, net: -50, winRate: 40 } }], found: [f] };

describe('foundName', () => {
  it('joins the checks and drops the bracketed detail', () => {
    expect(foundName(f)).toBe('Breakout of the last hour + EMA 21 rising');
  });
});

describe('withFound', () => {
  it('adds the combination switched off and keeps the saved ones', () => {
    const saved = [{ id: 'a', name: 'Mine', conds: ['x'], need: 1, window: 3, on: true }];
    const next = withFound(saved, f);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 'a', on: true });
    expect(next[1]).toMatchObject({ conds: f.conds, need: 2, on: false });
  });
  it('works with nothing saved', () => {
    expect(withFound(undefined, f)).toHaveLength(1);
  });
});

describe('alreadySaved', () => {
  it('matches the same checks in any order', () => {
    expect(alreadySaved([{ conds: ['ema21_rising', 'p_breakout'] }], f)).toBe(true);
    expect(alreadySaved([{ conds: ['p_breakout'] }], f)).toBe(false);
  });
});

describe('autoFindText', () => {
  it('lists the starting points and the found combinations', () => {
    const t = autoFindText(af);
    expect(t).toContain('40 combinations tried');
    expect(t).toContain('Starting point Breakout');
    expect(t).toContain('Breakout of the last hour (5m) + EMA 21 rising: 12 trades');
  });
  it('says so when nothing was found, or the run was skipped', () => {
    expect(autoFindText({ ...af, found: [] })).toContain('Nothing made money');
    expect(autoFindText({ skipped: 'needs at least 15 trading days, this run had 9' })).toContain('needs at least 15');
    expect(autoFindText(null)).toBe('');
  });
});

describe('adding checks to a saved combination', () => {
  const saved = [
    { id: 'all', name: 'Trend', conds: ['a', 'b'], need: 2, window: 3, on: true, side: 'CE', stopMode: 'atr', stopAtr: 1.5, stopPoints: 30, exits: { breakEven: 20 } },
    { id: 'some', name: 'Any two', conds: ['a', 'b', 'c'], need: 2, window: 4, on: false },
  ];
  it('joins the checks of an "all must hold" combination and keeps everything else', () => {
    expect(addChecks({ ...saved[0] }, ['x', 'a'])).toMatchObject({ conds: ['a', 'b', 'x'], need: 3, side: 'CE', stopMode: 'atr' });
  });
  it('keeps an "any N of M" rule and puts the add-on beside it as a must', () => {
    expect(addChecks({ ...saved[1] }, ['x'])).toMatchObject({ conds: ['a', 'b', 'c'], need: 2, also: ['x'] });
    expect(addChecks({ ...saved[1] }, ['x'], { all: true })).toMatchObject({ conds: ['a', 'b', 'c', 'x'], need: 4 });
  });
  it('updates one combination in place', () => {
    const list = withUpdated(saved, 'some', ['x']);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'all', conds: ['a', 'b'] });
    expect(list[1]).toMatchObject({ id: 'some', name: 'Any two', conds: ['a', 'b', 'c'], need: 2, also: ['x'], window: 4, on: false });
  });
  it('saves a copy with a new name, switched off', () => {
    const list = withCopy(saved, 'all', ['x'], ['RSI (14) above 50 (fast)']);
    expect(list).toHaveLength(3);
    expect(list[2]).toMatchObject({ name: 'Trend + RSI (14) above 50', conds: ['a', 'b', 'x'], on: false, side: 'CE', exits: { breakEven: 20 } });
    expect(list[2].id).toBeUndefined();
    const again = withCopy([...saved, { id: 'c', name: 'Trend + RSI (14) above 50', conds: ['a'], need: 1 }], 'all', ['x'], ['RSI (14) above 50']);
    expect(again.at(-1).name).toBe('Trend + RSI (14) above 50 (2)');
  });
  it('says when the picks are already in it', () => {
    expect(changesCombo(saved[0], ['a'])).toBe(false);
    expect(changesCombo({ ...saved[1], also: ['x'] }, ['x'])).toBe(false);
    expect(changesCombo(saved[0], ['x'])).toBe(true);
  });
});

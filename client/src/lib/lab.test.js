import { describe, expect, it } from 'vitest';
import { addonLine, entryMarkers, equityPath, equityRange, fixLine, labPath, togglePick, whenText } from './lab.js';

describe('lab helpers', () => {
  it('labPath carries the start, picks, days and prices', () => {
    expect(labPath({ base: 'combo:a', add: ['x', 'y'], days: 10, prices: 'real' })).toBe('/lab?base=combo%3Aa&days=10&prices=real&add=x%2Cy');
  });
  it('togglePick adds, removes and keeps the last three', () => {
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePick(['a', 'b'], 'a')).toEqual(['b']);
    expect(togglePick(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
  });
  it('addonLine and fixLine say what is skipped and what it costs', () => {
    const a = { removed: { trades: 3, losers: 2, losersNet: -4100, winners: 1, winnersNet: 900 }, added: { trades: 0, net: 0 } };
    expect(addonLine(a)).toContain('skips 3: 2 losers');
    expect(fixLine({ label: 'RSI above 50', winnersLost: 0, winnersLostNet: 0, gain: 2000 })).toContain('skips no winner');
  });
  it('entryMarkers greys a removed entry and marks the selected exit', () => {
    const c = { up: 'g', down: 'r', muted: 'm' };
    const e = [{ id: 'a', entryTime: 1000, exitTime: 1600, side: 'CE', net: 500, status: 'kept', reason: 'LOCK' }, { id: 'b', entryTime: 2000, exitTime: 2600, side: 'PE', net: -300, status: 'removed', reason: 'STOP' }];
    const m = entryMarkers(e, c, 'a');
    expect(m.find((x) => x.id === 'a').color).toBe('g');
    expect(m.find((x) => x.id === 'b').color).toBe('m');
    expect(m.some((x) => x.id === 'a:exit')).toBe(true);
  });
  it('equityPath starts at zero and shares a range', () => {
    expect(equityPath([{ time: 1, net: 100 }, { time: 2, net: -50 }])).toMatch(/^M/);
    expect(equityPath([])).toBe('');
    expect(equityRange([{ net: 5 }], [{ net: -9 }])).toEqual({ min: -9, max: 5 });
  });
  it('whenText gives an IST day and time', () => {
    expect(whenText(Date.UTC(2026, 9, 5, 4, 5) / 1000)).toBe('5 Oct 09:35');
  });
});

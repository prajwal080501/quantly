import { describe, expect, it } from 'vitest';
import { bandWords, chaseWords, rungLines, sameSteps } from './ladderTest.js';

describe('ladder tester words', () => {
  it('writes a ladder as rungs and the room above the last one', () => {
    expect(rungLines([{ at: 1500, keep: 200 }, { at: 2250, keep: 1500 }])).toEqual(['+₹1,500 → stop keeps ₹200', '+₹2,250 → stop keeps ₹1,500', 'above +₹2,250: ₹750 behind the best profit']);
    expect(rungLines([])[0]).toMatch(/No profit lock/);
  });
  it('says what the anti-chase check does', () => {
    expect(chaseWords(null)).toMatch(/^Off/);
    expect(chaseWords({ pct: 20, minutes: 15 })).toBe('On: no buy while the premium is over 20% above its 15-minute low.');
  });
  it('names the bands and compares ladders', () => {
    expect(bandWords({ from: null, to: 10 })).toBe('under 10%');
    expect(bandWords({ from: 30, to: null })).toBe('30% or more');
    expect(sameSteps([{ at: 1, keep: 0 }], [{ at: 1, keep: 0 }])).toBe(true);
    expect(sameSteps([{ at: 1, keep: 0 }], [])).toBe(false);
  });
});

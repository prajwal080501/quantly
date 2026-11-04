import { describe, expect, it } from 'vitest';
import { movedBandWords, skippedWords, isApplied, measureLine } from './movedTest.js';

describe('already-moved tester words', () => {
  it('bands read as ranges, with times as clock times', () => {
    expect(movedBandWords('run30', { from: null, to: 0.1 })).toBe('under 0.1%');
    expect(movedBandWords('stretch', { from: 1, to: 2 })).toBe('1 ATR to 2 ATR');
    expect(movedBandWords('minutes', { from: 870, to: null })).toBe('14:30 or later');
  });
  it('says what a limit skipped: losers, winners and the trades taken instead', () => {
    expect(skippedWords({ skipped: 0 })).toBe('skipped nothing');
    expect(skippedWords({ skipped: 3, badSkipped: 2, badSkippedNet: -5000, goodSkipped: 1, goodSkippedNet: 1200, added: 1, addedNet: 300 })).toBe('skipped 3: 2 losers (-₹5,000) and 1 winner (₹1,200); took 1 other instead (₹300)');
  });
  it('knows which row is saved now', () => {
    expect(isApplied({ apply: { movedCheck: 'run30', movedLimit: 0.3 } }, { movedCheck: 'run30', movedLimit: 0.3 })).toBe(true);
    expect(isApplied({ apply: { movedCheck: 'run30', movedLimit: 0.3 } }, { movedCheck: 'day', movedLimit: 0.3 })).toBe(false);
  });
  it('shows the measures of a trade', () => {
    expect(measureLine({ moved: { run30: 0.42, day: 0.8, rsi: 74, points: { run30: 98 } }, rise: 16 })).toBe('30-min run +0.42% (98 pts) · since open +0.8% · RSI 74 · premium +16%');
  });
});

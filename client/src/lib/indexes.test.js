import { describe, expect, it } from 'vitest';
import { INDEXES, indexOf, indexWords, loadIndex, saveIndex } from './indexes.js';

describe('indexes', () => {
  it('knows only the Nifty, by the name the feed uses', () => {
    expect(INDEXES.map((i) => [i.key, i.symbol])).toEqual([['NIFTY', 'NIFTY 50']]);
    expect(indexOf('SENSEX').key).toBe('NIFTY');
    expect(indexOf('nope').key).toBe('NIFTY');
  });

  it('writes a list of indexes in words', () => {
    expect(indexWords(['NIFTY'])).toBe('Nifty');
  });

  it('always gives the Nifty, even when something else was remembered', () => {
    localStorage.clear();
    expect(loadIndex()).toBe('NIFTY');
    localStorage.setItem('npt_options_index', 'SENSEX');
    expect(loadIndex()).toBe('NIFTY');
  });
});

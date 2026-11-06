import { describe, expect, it } from 'vitest';
import { quoteView } from './quoteFreshness.js';

const now = 1_700_000_000_000;

describe('quoteView', () => {
  it('shows a fresh Upstox tick with its exchange time', () => {
    const view = quoteView({ ltp: 100, ltt: now - 1000, source: 'upstox' }, now);
    expect(view.state).toBe('fresh');
    expect(view.ltp).toBe(100);
    expect(view.label).toMatch(/Upstox/);
  });

  it('does not present an old last-trade time as live', () => {
    const view = quoteView({ ltp: 100, ltt: now - 60_000, feedTs: now, source: 'upstox' }, now);
    expect(view.state).toBe('stale');
    expect(view.label).toMatch(/Stale/);
  });

  it('does not invent a timestamp from the local clock', () => {
    const view = quoteView({ ltp: 100, ts: now, source: 'upstox' }, now);
    expect(view.state).toBe('unavailable');
    expect(view.ltp).toBeNull();
  });
});

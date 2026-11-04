import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import result from './movedFixture.json';
import { MovedTester } from './MovedTester.jsx';
import { api } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../lib/useApi.js', () => ({ useApi: () => ({ data: { settings: { movedCheck: 'off', movedLimit: 0, movedText: null, chasePct: 0, chaseMinutes: 15, pausedToday: false } }, reload: () => {} }) }));
vi.mock('../../lib/useStudy.js', () => ({ useStudy: () => ({ state: { status: { state: 'idle' }, result, note: 'note' }, error: null, running: false, run: vi.fn() }) }));

describe('MovedTester', () => {
  it('shows the advice next to taking every entry, what the pick skipped, and saves it with one tap', () => {
    render(
      <MemoryRouter>
        <MovedTester />
      </MemoryRouter>,
    );
    expect(screen.getByText(result.advice.text)).toBeTruthy();
    expect(screen.getByText('Take every entry (no check)')).toBeTruthy();
    fireEvent.click(screen.getByText('Use this check'));
    const pick = result.rows.find((r) => r.key === result.advice.key);
    expect(api).toHaveBeenCalledWith('/options', { method: 'PUT', body: pick.apply });
    fireEvent.click(screen.getByText('Time'));
    expect(screen.getAllByText(/trades ·/).length).toBeGreaterThan(3);
  });
});

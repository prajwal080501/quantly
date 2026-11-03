import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import result from './ladderFixture.json';
import { LadderTester } from './LadderTester.jsx';
import { api } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../lib/useApi.js', () => ({
  useApi: (path) => ({ data: path === '/options' ? { settings: { chasePct: 0, chaseMinutes: 15 } } : { options: { steps: result.rows.find((r) => r.key === 'current').steps } }, reload: () => {} }),
}));
vi.mock('../../lib/useStudy.js', () => ({ useStudy: () => ({ state: { status: { state: 'idle' }, result, note: 'note' }, error: null, running: false, run: vi.fn() }) }));

describe('LadderTester', () => {
  it('shows the advice, your ladder next to the pick, and saves the pick with one tap', () => {
    render(
      <MemoryRouter>
        <LadderTester />
      </MemoryRouter>,
    );
    expect(screen.getByText(result.advice.text)).toBeTruthy();
    expect(screen.getByText('Your ladder now')).toBeTruthy();
    fireEvent.click(screen.getByText('Use this ladder'));
    const pick = result.rows.find((r) => r.key === result.advice.key);
    expect(api).toHaveBeenCalledWith('/trade-defaults', { method: 'PUT', body: { options: { steps: pick.steps, lockOn: true } } });
  });
});

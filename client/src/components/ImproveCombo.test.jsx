import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImproveCombo } from './ImproveCombo.jsx';
import { api } from '../lib/api.js';

const saved = [{ id: 'm', name: 'Breakout + RSI', conds: ['a', 'b'], need: 2, window: 3, on: true, stopMode: 'fixed', stopAtr: 2, stopPoints: 40 }, { id: 'n', name: 'Other', conds: ['c', 'd', 'e'], need: 2, window: 3, on: false }];
vi.mock('../lib/useApi.js', () => ({ useApi: () => ({ data: { settings: { combos: saved } }, reload: () => {} }) }));
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ conditions: [] })) }));

const improve = {
  id: 'm',
  name: 'Breakout + RSI',
  conds: ['a', 'b'],
  add: [],
  base: { trades: 6, wins: 4, net: 3000 },
  rows: [
    { key: 'ema', label: 'EMA 9 above EMA 21', group: 'Trend', kept: { trades: 4, wins: 4, net: 9000 }, skipped: { trades: 2, losers: 2, losersNet: -4100, winners: 0, winnersNet: 0 }, added: { trades: 0, net: 0 }, gain: 4100 },
    { key: 'vol', label: 'Volume 1.5 times the usual', group: 'Volume', kept: { trades: 3, wins: 2, net: 1000 }, skipped: { trades: 3, losers: 1, losersNet: -900, winners: 2, winnersNet: 5000 }, added: { trades: 0, net: 0 }, gain: -4100 },
  ],
};

describe('ImproveCombo', () => {
  it('shows the combination now, ranks the indicators and sends the picks up', () => {
    const setTrial = vi.fn();
    render(<ImproveCombo combos={[{ id: 'm', name: 'Breakout + RSI' }]} trial={{ id: 'm', add: [] }} setTrial={setTrial} improve={improve} newEntries={null} loading={false} />);
    expect(screen.getByText('6 entries, 4 won, 2 lost')).toBeTruthy();
    expect(screen.getByText(/skips 2 entries \(2 losers/)).toBeTruthy();
    expect(screen.getByText(/saves/)).toBeTruthy();
    expect(screen.getByText(/costs/)).toBeTruthy();
    fireEvent.click(screen.getByText(/EMA 9 above EMA 21/));
    expect(setTrial).toHaveBeenCalledWith({ id: 'm', add: ['ema'] });
  });
  it('shows the new combination beside the old one once something is picked', () => {
    const entries = [{ id: 'x', lock: { net: 5000 }, target: { net: 1 } }, { id: 'y', lock: { net: 4000 }, target: { net: 1 } }];
    render(<ImproveCombo combos={[{ id: 'm', name: 'Breakout + RSI' }]} trial={{ id: 'm', add: ['ema'] }} setTrial={() => {}} improve={{ ...improve, add: ['ema'] }} newEntries={entries} loading={false} />);
    expect(screen.getByText('2 entries, 2 won, 0 lost')).toBeTruthy();
    expect(screen.getByText('Save as new combination')).toBeTruthy();
    expect(screen.getByText('Update Breakout + RSI')).toBeTruthy();
  });
  it('updates the combination in place after a second tap, keeping its stop', async () => {
    api.mockClear();
    render(<ImproveCombo combos={[{ id: 'm', name: 'Breakout + RSI' }]} trial={{ id: 'm', add: ['ema'] }} setTrial={() => {}} improve={{ ...improve, add: ['ema'] }} newEntries={null} loading={false} />);
    fireEvent.click(screen.getByText('Update Breakout + RSI'));
    expect(screen.getByText(/It is switched on/)).toBeTruthy();
    fireEvent.click(screen.getByText('Yes, update it'));
    const put = api.mock.calls.find(([path, o]) => path === '/options' && o?.method === 'PUT');
    expect(put[1].body.combos).toHaveLength(2);
    expect(put[1].body.combos[0]).toMatchObject({ id: 'm', name: 'Breakout + RSI', conds: ['a', 'b', 'ema'], need: 3, on: true, stopMode: 'fixed', stopPoints: 40 });
    expect(put[1].body.combos[1]).toMatchObject({ id: 'n', conds: ['c', 'd', 'e'], need: 2 });
  });
  it('saves a copy as a new combination, switched off, and leaves the original alone', () => {
    api.mockClear();
    render(<ImproveCombo combos={[{ id: 'm', name: 'Breakout + RSI' }]} trial={{ id: 'm', add: ['ema'] }} setTrial={() => {}} improve={{ ...improve, add: ['ema'] }} newEntries={null} loading={false} />);
    fireEvent.click(screen.getByText('Save as new combination'));
    const put = api.mock.calls.find(([path, o]) => path === '/options' && o?.method === 'PUT');
    const list = put[1].body.combos;
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: 'm', conds: ['a', 'b'], on: true });
    expect(list[2]).toMatchObject({ name: 'Breakout + RSI + EMA 9 above EMA 21', conds: ['a', 'b', 'ema'], need: 3, on: false, stopMode: 'fixed' });
    expect(list[2].id).toBeUndefined();
  });
  it('lists other stops, ladders and trails against what is set now, best first, one group at a time', () => {
    const row = (key, group, label, net, gain) => ({ key, group, label, trades: 6, wins: 4, net, worst: -900, gain });
    const tries = { of: 'combination', now: { trades: 6, wins: 4, net: 3000, worst: -900 }, rows: [row('s1', 'stoprule', 'Stop 30 points from the entry', 1000, -2000), row('s2', 'stoprule', 'Stop 50 points from the entry', 4500, 1500), row('l1', 'ladder', 'Wide room, 6 steps', 3800, 800)] };
    render(<ImproveCombo combos={[{ id: 'm', name: 'Breakout + RSI' }]} trial={{ id: 'm', add: [] }} setTrial={() => {}} improve={{ ...improve, tries }} newEntries={null} loading={false} />);
    fireEvent.click(screen.getByText('Stop loss and profit ladder'));
    const labels = screen.getAllByText(/^Stop \d+ points/).map((n) => n.textContent);
    expect(labels).toEqual(['Stop 50 points from the entry', 'Stop 30 points from the entry']);
    expect(screen.queryByText('Wide room, 6 steps')).toBeNull();
    fireEvent.click(screen.getByText('Profit ladder'));
    expect(screen.getByText('Wide room, 6 steps')).toBeTruthy();
  });
});

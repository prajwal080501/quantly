import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { canAdd, withFound, withUpdated } from '../lib/autoFind.js';

/**
 * The two ways to keep a combination with extra checks added: change the saved one in place ("Update"), or keep the old one and
 * save the new checks next to it, switched off ("Save as new"). `found` is { conds, labels }; `baseId` is the saved combination
 * the checks were added to (null when the start was a single check or a pattern, then only "Save as new" shows).
 */
export function SaveComboButtons({ saved, found, baseId = null, baseName = '', stop = null, exits = null, endpoint = '/options', onSaved, disabled = false }) {
  const [busy, setBusy] = useState(null);
  const base = baseId ? (saved || []).find((c) => c.id === baseId) : null;
  async function send(kind) {
    const combos = kind === 'update' ? withUpdated(saved, baseId, found.conds, stop, exits) : withFound(saved, found, stop, exits);
    if (!combos) return toast.error('That combination is no longer saved');
    setBusy(kind);
    try {
      await api(endpoint, { method: 'PUT', body: { combos } });
      onSaved?.();
      toast.success(kind === 'update' ? `${base?.name ?? baseName} now has the new checks${base?.on ? ' and stays switched on' : ''}.` : 'Saved as a new combination, switched off. Turn it on under Account > Entries.');
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {base && (
        <button type="button" className="btn btn-primary btn-sm" disabled={disabled || busy != null} onClick={() => send('update')}>
          {busy === 'update' ? 'Saving…' : `Update "${base.name}"`}
        </button>
      )}
      <button type="button" className="btn btn-sm" disabled={disabled || busy != null || !saved || !canAdd(saved)} onClick={() => send('new')}>
        {busy === 'new' ? 'Saving…' : canAdd(saved) ? 'Save as a new combination (off)' : 'My combinations is full (30)'}
      </button>
    </div>
  );
}

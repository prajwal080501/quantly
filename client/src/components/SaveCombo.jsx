import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { canAdd, updateText, withFound, withUpdated } from '../lib/autoFind.js';

/**
 * The two ways to keep an indicator you added: change the combination you started from ("Update"), or keep that one as it is and save
 * the result as a new combination, switched off ("Save as new"). Used by the Combination Lab, Review > Improve a combination and the Finder.
 * @param saved     the saved combinations (settings.combos)
 * @param baseId    the id of the saved combination this started from, or null when it started from a pattern (then only "Save as new")
 * @param addKeys   the checks being added
 * @param found     { conds, labels } of the whole new combination, for "Save as new"
 */
export function SaveCombo({ saved, baseId = null, addKeys, addLabels, found, endpoint = '/options', stop = null, exits = null, onSaved, compact = false }) {
  const [busy, setBusy] = useState(false);
  const base = baseId ? (saved || []).find((c) => c.id === baseId) : null;
  const full = !canAdd(saved);

  async function send(list, done) {
    setBusy(true);
    try {
      await api(endpoint, { method: 'PUT', body: { combos: list } });
      onSaved?.();
      toast.success(done);
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function update() {
    if (!window.confirm(`Update this combination?\n\n${updateText(base, addLabels)}`)) return;
    const list = withUpdated(saved, baseId, addKeys, { stop, exits });
    if (!list) return toast.error('That combination is not saved any more.');
    send(list, `Updated "${base.name}".`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {base && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !saved} onClick={update}>
          Update “{base.name.length > 24 ? `${base.name.slice(0, 22)}…` : base.name}”
        </button>
      )}
      <button type="button" className="btn btn-sm" disabled={busy || !saved || full} onClick={() => send(withFound(saved, found, stop, exits), 'Saved as a new combination, switched off. Turn it on under Account > Entries.')}>
        {full ? 'My combinations is full (30)' : compact ? 'Save as new (off)' : 'Save as a new combination (off)'}
      </button>
    </div>
  );
}

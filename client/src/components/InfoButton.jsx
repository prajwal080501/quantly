import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { Sheet } from './ui.jsx';

let catalogPromise = null; // the check list is the same for everyone, so it is fetched once per visit
const loadCatalog = () => {
  if (!catalogPromise) catalogPromise = api('/combos/catalog').catch((e) => {
    catalogPromise = null;
    throw e;
  });
  return catalogPromise;
};

/** A check key from anything the screens show: a check ('rsiAbove50'), a study pattern ('breakout') or a pattern check ('p_breakout'). */
export const condKeyOf = (key, conditions) => {
  if (!key) return null;
  if (conditions.some((c) => c.key === key)) return key;
  if (conditions.some((c) => c.key === `p_${key}`)) return `p_${key}`;
  return null;
};

function Section({ title, children }) {
  if (!children) return null;
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="text-xs leading-relaxed text-muted">{children}</p>
    </section>
  );
}

/** The info popup: what a check is, how it is worked out, when it turns true and the trap in it. */
export function InfoSheet({ cond, onClose }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    loadCatalog()
      .then((cat) => live && setState({ cat }))
      .catch((e) => live && setState({ error: e.message }));
    return () => {
      live = false;
    };
  }, []);
  const list = state.cat?.conditions || [];
  const c = list.find((x) => x.key === condKeyOf(cond, list));
  const i = c?.info;
  return (
    <Sheet title={c ? c.label : 'About this check'} subtitle={c ? `${c.group}${i?.family && i.family !== c.group ? ` · ${i.family}` : ''}` : ''} onClose={onClose}>
      <div className="space-y-3 pb-2 pt-3">
        {state.loading && <p className="text-xs text-muted">Loading…</p>}
        {state.error && <p className="text-xs text-down">{state.error}</p>}
        {state.cat && !c && <p className="text-xs text-muted">No notes for this one yet.</p>}
        {c && (
          <>
            <Section title="The rule">{i?.rule ?? c.text}</Section>
            <Section title="What it is">{i?.what}</Section>
            <Section title="How it is worked out">{i?.how}</Section>
            <Section title="When it triggers">{[i?.when, i?.kind].filter(Boolean).join(' ')}</Section>
            <Section title="Calls and puts">{i?.put}</Section>
            <Section title="The trap">{i?.trap}</Section>
            {c.needs && <p className="text-[11px] text-warn">Needs {c.needs === 'flow' ? 'the volume of the 50 stocks' : c.needs === 'breadth' ? 'the 50-stock breadth' : c.needs}, so it is only usable when that data is saved.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** A small (i) button that opens the info popup for a check or a pattern. */
export function InfoButton({ cond, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!cond) return null;
  return (
    <>
      <button
        type="button"
        aria-label="What is this check?"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-muted hover:bg-surface-2 hover:text-accent ${className}`}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && <InfoSheet cond={cond} onClose={() => setOpen(false)} />}
    </>
  );
}

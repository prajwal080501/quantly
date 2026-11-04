import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { conditionInfo, conditionsInLabel, findCondition, loadCatalog } from '../lib/info.js';
import { Sheet } from './ui.jsx';

function Section({ title, children }) {
  if (!children) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <p className="text-sm leading-snug">{children}</p>
    </div>
  );
}

/** One check explained: its rule, how its group works, state or event, the put twin, what it is good with and when it lets you down. */
export function ConditionInfo({ cond }) {
  const i = conditionInfo(cond);
  if (!i) return null;
  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-surface-2 p-3">
      <div>
        <div className="font-semibold">{i.title}</div>
        <div className="text-[11px] text-muted">{i.group}</div>
      </div>
      <Section title="When it turns true">{i.rule}</Section>
      <Section title="How this kind of check works">{i.how}</Section>
      <Section title="State or event">{i.kind}</Section>
      <Section title="Good for">{i.good}</Section>
      <Section title="Watch out">{i.watch}</Section>
      <Section title="Calls and puts">{i.put}</Section>
      <Section title="Data it needs">{i.needs}</Section>
    </div>
  );
}

/**
 * The small "i" next to an indicator, pattern or combination. `of` is a check key, a pattern key or a label; `keys` is a list of check
 * keys (a combination); `label` is a combination's name like "Breakout + RSI over 50", split into its checks.
 */
export function InfoButton({ of = null, keys = null, label = null, title = null, className = '' }) {
  const [open, setOpen] = useState(false);
  const [conds, setConds] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || conds) return;
    loadCatalog()
      .then((c) => {
        const all = c.conditions;
        const list = keys?.length ? keys.map((k) => findCondition(all, k)).filter(Boolean) : of ? [findCondition(all, of)].filter(Boolean) : conditionsInLabel(all, label);
        setConds(list);
      })
      .catch(() => setFailed(true));
  }, [open, conds, of, keys, label]);
  const name = title || label || of || 'this';
  return (
    <>
      <button
        type="button"
        aria-label={`About ${name}`}
        title="How it works"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-accent hover:bg-accent-soft ${className}`}
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <Sheet title={`About ${name}`} subtitle="What it measures and when it fires" onClose={() => setOpen(false)}>
          <div className="space-y-3 pt-2">
            {failed && <p className="text-sm text-down">Could not load the list of checks. Try again.</p>}
            {!failed && !conds && <p className="text-sm text-muted">Loading…</p>}
            {conds && conds.length === 0 && <p className="text-sm text-muted">No description found for {name}. Its rule is shown where it is listed.</p>}
            {conds && conds.length > 1 && (
              <p className="text-sm leading-snug">
                A combination fires on the first bar where <b>all of these</b> hold together (or the number it asks for). Each part is explained below. More parts means fewer, pickier trades, not always better ones.
              </p>
            )}
            {conds?.map((c) => <ConditionInfo key={c.key} cond={c} />)}
            <p className="text-[11px] leading-snug text-muted">No indicator predicts the market. Each one only shifts the odds a little, and only in some kinds of day. Judge it by its trades over many weeks, not by one good day.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}

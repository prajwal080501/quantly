import { formatPnl } from './format.js';
import { MAX_CHECKS, fromSaved, toPayload } from './combos.js';

export const MAX_COMBOS = 30; // the most combinations the server keeps

const part = (p) => `${p.trades} trades, ${p.winRate ?? '-'}% win, ${formatPnl(p.net)}`;

/** The name a found combination is saved under: its checks, shortened. */
export const foundName = (f) => f.labels.map((l) => l.replace(/ \(.*\)$/, '')).join(' + ').slice(0, 60);

/** Whether the saved combinations already hold this exact set of checks. */
export const alreadySaved = (saved, f) => (saved || []).some((c) => c.conds.length === f.conds.length && f.conds.every((k) => c.conds.includes(k)));

/** The saved combinations plus the found one, switched off so nothing trades until the user looks at it. */
export function withFound(saved, f, stop = null, exits = null) {
  const list = (saved || []).map((c, i) => toPayload(fromSaved(c), i));
  return [...list, { name: foundName(f), conds: f.conds, need: f.conds.length, window: 3, on: false, ...(stop ? { stopMode: stop.mode, stopAtr: stop.k, stopPoints: stop.points } : {}), ...(exits ? { exits } : {}) }];
}

export const canAdd = (saved) => (saved || []).length < MAX_COMBOS;

export const MAX_ALSO = 6; // add-on checks the server keeps on top of an "any N of M" rule

/**
 * A combination (as sent to the server) with `add` checks that must hold too. With the rule "all must hold" they simply join its checks;
 * with "any N of M" they go to `also`, so the rule stays as it was and the add-ons must hold on top, as the Lab and Review tried it.
 * `all`: make every check, old and new, a must (what the Finder tested).
 */
export function addChecks(p, add, { all = false } = {}) {
  const has = new Set([...p.conds, ...(p.also || [])]);
  const fresh = [...new Set(add)].filter((k) => !has.has(k));
  const ruleAll = p.need >= p.conds.length;
  if (ruleAll || all) {
    const conds = [...p.conds, ...(p.also || []), ...fresh].slice(0, MAX_CHECKS);
    const { also: _a, ...rest } = p;
    return { ...rest, conds, need: conds.length };
  }
  return { ...p, also: [...(p.also || []), ...fresh].slice(0, MAX_ALSO) };
}

/** The saved combinations with the one called `id` changed in place: the `add` checks join it, everything else (name, on/off, stop, exits) stays. */
export function withUpdated(saved, id, add, opts) {
  return (saved || []).map((c, i) => {
    const p = toPayload(fromSaved(c), i);
    return c.id === id ? addChecks(p, add, opts) : p;
  });
}

/** A name for the copy that does not clash with a saved one. */
function freshName(saved, name) {
  const taken = new Set((saved || []).map((c) => c.name));
  const base = name.slice(0, 54);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 99; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
  return base;
}

/**
 * The saved combinations plus a copy of the one called `id` with the `add` checks: same rule, side, stop and exits, a new name, switched
 * off so nothing trades until the user looks at it. The original is not touched.
 */
export function withCopy(saved, id, add, labels, opts) {
  const list = (saved || []).map((c, i) => toPayload(fromSaved(c), i));
  const src = list.find((c) => c.id === id);
  if (!src) return list;
  const { id: _id, ...rest } = addChecks(src, add, opts);
  const name = freshName(saved, [src.name, ...labels.map((l) => l.replace(/ \([^()]*\)$/, ''))].join(' + '));
  return [...list, { ...rest, name, on: false }];
}

/** Whether `add` would change the combination at all (every one of them may already be in it). */
export const changesCombo = (combo, add) => Boolean(combo) && add.some((k) => !combo.conds.includes(k) && !(combo.also || []).includes(k));

/** The auto-find result as plain text, to paste into the chat. */
export function autoFindText(af) {
  if (!af) return '';
  if (af.skipped) return `Auto-find: ${af.skipped}.`;
  const lines = ['', `Auto-find (${af.tried} combinations tried; found on the older ${af.trainDays} days, checked on the newer ${af.testDays} days it had not seen${af.trainEnd ? `; one day: ${af.trainEnd}` : ''}):`];
  for (const b of af.baselines) lines.push(`Starting point ${b.label}: older ${part(b.train)}; newer ${part(b.test)}`);
  if (!af.found.length) lines.push('Nothing made money on both the older and the newer days.');
  for (const f of af.found) lines.push(`${f.labels.join(' + ')}: ${f.trades} trades, ${f.winRate ?? '-'}% win, ${formatPnl(f.net)}; older ${part(f.train)}; newer ${part(f.test)}`);
  return lines.join('\n');
}


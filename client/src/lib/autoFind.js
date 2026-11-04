import { formatPnl } from './format.js';
import { fromSaved, toPayload } from './combos.js';

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

/**
 * The saved combinations with `id` updated in place: the new checks join it. A combination where every check must hold simply gets more
 * checks; one that needs "any 2 of 4" keeps that rule and the new checks go in `also` (they must hold on top of it). Its name, on/off,
 * stop and exits stay as they were, unless a stop or exits are given. Returns null when the combination is not saved any more.
 */
export function withUpdated(saved, id, addKeys, { stop = null, exits = null } = {}) {
  const list = (saved || []).map((c, i) => ({ ...toPayload(fromSaved(c), i), ...(c.also?.length ? { also: c.also } : {}) }));
  const at = list.findIndex((c) => c.id === id);
  if (at < 0) return null;
  const c = list[at];
  const fresh = addKeys.filter((k) => !c.conds.includes(k) && !(c.also || []).includes(k));
  const all = c.need >= c.conds.length;
  const next = all ? { ...c, conds: [...c.conds, ...fresh], need: c.conds.length + fresh.length } : { ...c, also: [...(c.also || []), ...fresh] };
  if (stop) Object.assign(next, { stopMode: stop.mode, stopAtr: stop.k, stopPoints: stop.points });
  if (exits) next.exits = exits;
  list[at] = next;
  return list;
}

/** What "Update" will do, in words for the confirm box. */
export function updateText(combo, addLabels) {
  const all = !combo || combo.need >= combo.conds.length;
  return `${addLabels.join(' + ')} will be added to "${combo?.name ?? 'the combination'}"${all ? ' (all its checks must hold, as now)' : ' as extra checks that must also hold on top of its rule'}. It keeps its name${combo?.on ? ' and stays ON, so the bot uses the new rule from the next signal' : ' and stays off'}. To keep the old one as it is, use "Save as new" instead.`;
}

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

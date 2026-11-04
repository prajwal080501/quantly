import { measure, MIN_SPLIT_DAYS, MIN_FIT_TRADES } from './ladderTest.js';
import { CHASE_CHOICES } from '../options/chase.js';
import { MOVED_CHECKS, movedWords } from '../options/moved.js';
import { round2 } from '../utils/money.js';

// The "already moved" tester. Sachin, 4 Nov 2026: "the Nifty has already risen and we still take those trades". It replays the entries the
// live trader would have taken on the saved real option prices, once with no check and once for each limit on how far the move had already
// gone: the index's run from its 30/60-minute low, its move since the open, its stretch from the day average, its RSI, the premium's run from
// its own low (the anti-chase check of the ladder tester) and a last time for a new trade. Each limit is picked on the older days and is
// recommended only when it also did at least as well on the newest days it never saw. Read-only: nothing live changes until the user taps Use.

export const LATE_CHOICES = [12 * 60, 12 * 60 + 30, 13 * 60, 13 * 60 + 30, 14 * 60, 14 * 60 + 30];
export const CHASE_LOOKBACKS = [15, 30];
const BAND_EDGES = {
  run30: [0.1, 0.2, 0.3, 0.5],
  run60: [0.15, 0.3, 0.45, 0.6],
  day: [0, 0.3, 0.6, 0.9],
  stretch: [0.5, 1, 2, 3],
  rsi: [50, 60, 70, 80],
  rise: [10, 20, 30, 50],
  minutes: [11 * 60, 12 * 60 + 30, 13 * 60 + 30, 14 * 60 + 30],
};

const rs = (v) => `${v < 0 ? '-' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const tradeKey = (t) => `${t.entryTime}|${t.side}`;
const valueOf = (t, key) => (key === 'rise' ? t.rise : t.moved?.[key]) ?? null;

/** Every limit the tester tries: one row per family x threshold, in order from loose to tight within a family. */
export function movedCandidates({ entryTo = 915, entryKey = 'entryTo' } = {}) {
  const rows = [];
  for (const c of MOVED_CHECKS) {
    // loose (a big limit skips little) to tight, so neighbours in the list are neighbours in value
    for (const limit of [...c.choices].reverse()) rows.push({ key: `${c.key}-${limit}`, family: c.key, limit, label: `${c.label}: over ${limit}${c.unit === '%' ? '%' : c.unit === 'ATR' ? ' ATR' : ''}`, text: movedWords({ key: c.key, limit }), set: { moved: { key: c.key, limit } }, apply: { movedCheck: c.key, movedLimit: limit } });
  }
  for (const minutes of CHASE_LOOKBACKS) {
    for (const pct of [...CHASE_CHOICES].reverse()) rows.push({ key: `chase${minutes}-${pct}`, family: `chase${minutes}`, limit: pct, label: `Premium over ${pct}% above its ${minutes}-minute low`, text: `Skip a buy when the option premium is over ${pct}% above its low of the last ${minutes} minutes.`, set: { chase: { pct, minutes } }, apply: { chasePct: pct, chaseMinutes: minutes } });
  }
  for (const m of [...LATE_CHOICES].reverse()) {
    if (m >= entryTo) continue;
    rows.push({ key: `late-${m}`, family: 'late', limit: m, label: `No new trade from ${hhmm(m)}`, text: `No new automatic buy from ${hhmm(m)} (now ${hhmm(entryTo)}).`, set: { lastEntry: m }, apply: { [entryKey]: m } });
  }
  return rows;
}

const split = (trades, trainEnd) => ({ all: measure(trades), fit: measure(trades.filter((t) => t.entryTime < trainEnd)), check: measure(trades.filter((t) => t.entryTime >= trainEnd)) });

/** What a limit did to the trades of the "no check" run: the ones it skipped (split into winners and losers) and the ones it took instead. */
export function blockedVs(base, trades) {
  const mine = new Set(trades.map(tradeKey));
  const theirs = new Set(base.map(tradeKey));
  const gone = base.filter((t) => !mine.has(tradeKey(t)));
  const added = trades.filter((t) => !theirs.has(tradeKey(t)));
  const wins = gone.filter((t) => t.net > 0);
  const losses = gone.filter((t) => t.net <= 0);
  return {
    skipped: gone.length,
    goodSkipped: wins.length, // winners the limit would have stopped you taking
    goodSkippedNet: round2(wins.reduce((s, t) => s + t.net, 0)),
    badSkipped: losses.length, // losers it saved you from
    badSkippedNet: round2(losses.reduce((s, t) => s + t.net, 0)),
    added: added.length, // other trades it let in (a skip frees the slot, the trade count and the cooldowns)
    addedNet: round2(added.reduce((s, t) => s + t.net, 0)),
  };
}

/** Within a family, a limit's "pick" score is the average of its older-days result and its neighbours': a lucky spike next to poor neighbours does not win. */
function smooth(rows) {
  const families = new Map();
  for (const r of rows) if (r.family !== 'off' && r.family !== 'now') families.set(r.family, [...(families.get(r.family) ?? []), r]);
  for (const list of families.values()) {
    list.forEach((r, i) => {
      const near = [list[i - 1], r, list[i + 1]].filter(Boolean);
      r.pickScore = round2(near.reduce((s, x) => s + x.fit.net, 0) / near.length);
    });
  }
}

/**
 * Picks on the older days, checks on the newer: the best "pick" score among the limits that skipped something and kept enough trades on the
 * older days. It is recommended only when it beat no check on the older days and did at least as well on the newest days it never saw.
 */
export function recommendMoved(rows, { splitOk }) {
  const off = rows.find((r) => r.key === 'off');
  if (!splitOk) return { verdict: 'short', text: `Fewer than ${MIN_SPLIT_DAYS} days of real option prices are saved, too few to pick on some days and check on others. Run this again in a few days.` };
  const pool = rows.filter((r) => r.pickScore != null && r.fit.trades >= MIN_FIT_TRADES && r.vsOff.skipped > 0).sort((a, b) => b.pickScore - a.pickScore || b.fit.net - a.fit.net);
  const pick = pool[0];
  if (!pick || !(pick.fit.net > off.fit.net)) return { verdict: 'off', text: 'No limit on an already-moved market beat taking every entry on the older days. The trades after a big move were not worse than the rest, so no check is recommended.' };
  if (!(pick.check.net >= off.check.net)) return { verdict: 'off', tried: pick.key, text: `"${pick.label}" helped on the older days, but on the newest days (which it never saw) it made ${rs(pick.check.net)} against ${rs(off.check.net)} with no check. It did not hold up, so no check is recommended.` };
  return { verdict: 'on', key: pick.key, text: `"${pick.label}" did best on the older days and also beat taking every entry on the newest days it never saw: ${rs(pick.check.net)} against ${rs(off.check.net)}. Of your ${off.all.trades} trades it skipped ${pick.vsOff.skipped}: ${pick.vsOff.badSkipped} losers worth ${rs(pick.vsOff.badSkippedNet)}${pick.vsOff.goodSkipped ? `, but also ${pick.vsOff.goodSkipped} winners worth ${rs(pick.vsOff.goodSkippedNet)}` : ' and no winners'}.` };
}

/** The "no check" trades grouped by how far a measure had already run at the entry, so you can see whether late entries really lost. */
export function bandsOf(trades, key) {
  const edges = BAND_EDGES[key];
  const known = trades.filter((t) => valueOf(t, key) != null);
  const out = [];
  for (let i = 0; i <= edges.length; i++) {
    const lo = i === 0 ? null : edges[i - 1];
    const hi = i === edges.length ? null : edges[i];
    const xs = known.filter((t) => (lo == null || valueOf(t, key) >= lo) && (hi == null || valueOf(t, key) < hi));
    out.push({ from: lo, to: hi, trades: xs.length, wins: xs.filter((t) => t.net > 0).length, net: round2(xs.reduce((s, t) => s + t.net, 0)) });
  }
  return out;
}

const slim = (t) => ({ side: t.side, technique: t.technique, entryTime: t.entryTime, exitTime: t.exitTime, strike: t.strike, lots: t.lots, entryPremium: t.entryPremium, best: t.best, net: t.net, reason: t.reason, rise: t.rise ?? null, moved: t.moved ? { run30: t.moved.run30, run60: t.moved.run60, day: t.moved.day, stretch: t.moved.stretch, rsi: t.moved.rsi, minutes: t.moved.minutes, points: t.moved.points } : null });

/**
 * @param signals    the entries the live trader would take (its patterns and combinations), with their stops
 * @param tradesFor  (signals, params) -> { trades, skips }: the study's trader with the live rules
 * @param trainEnd   the first moment of the newest days, which are kept back for the check
 * @param params     the study params as live: `moved`, `chase` and `entryTo` are your settings now; `entryKey` is where a time limit is saved
 */
export async function runMovedTest({ signals, tradesFor, trainEnd, splitOk, params, onProgress = () => {}, yieldTurn = () => Promise.resolve() }) {
  const plain = { ...params, moved: null, chase: null, lastEntry: null, withMeasures: true };
  const run = (extra) => tradesFor(signals, { ...plain, ...extra });

  onProgress('Replaying every entry with no check');
  const base = run({});
  const rows = [{ key: 'off', family: 'off', label: 'No check: take every entry', text: 'Every entry the live rules allow, however far the market had already moved.', ...split(base.trades, trainEnd), vsOff: blockedVs(base.trades, base.trades), apply: { movedCheck: 'off', movedLimit: 0, chasePct: 0 } }];
  const nowSet = { moved: params.moved ?? null, chase: params.chase ?? null };
  if (nowSet.moved || nowSet.chase) {
    const mine = run(nowSet);
    rows.push({ key: 'now', family: 'now', label: 'Your settings now', text: [nowSet.moved && movedWords(nowSet.moved), nowSet.chase && `Premium check: over ${nowSet.chase.pct}% above its ${nowSet.chase.minutes}-minute low`].filter(Boolean).join('. '), ...split(mine.trades, trainEnd), vsOff: blockedVs(base.trades, mine.trades) });
  }
  const list = movedCandidates({ entryTo: params.entryTo ?? 915, entryKey: params.entryKey ?? 'entryTo' });
  for (const [n, c] of list.entries()) {
    if (n % 5 === 0) onProgress(`Trying limits: ${n + 1}/${list.length}`);
    const { trades } = run(c.set);
    const { set: _s, ...row } = c;
    rows.push({ ...row, ...split(trades, trainEnd), vsOff: blockedVs(base.trades, trades) });
    await yieldTurn();
  }
  smooth(rows);
  const advice = recommendMoved(rows, { splitOk });
  const bands = Object.fromEntries(['run30', 'run60', 'day', 'stretch', 'rsi', 'rise', 'minutes'].map((k) => [k, bandsOf(base.trades, k)]));
  // the best limit of each family (by its pick score), so the screen can show one line per kind of check
  const families = [...new Set(rows.filter((r) => r.pickScore != null).map((r) => r.family))].map((family) => {
    const xs = rows.filter((r) => r.family === family && r.fit.trades >= MIN_FIT_TRADES && r.vsOff.skipped > 0).sort((a, b) => b.pickScore - a.pickScore);
    return { family, best: xs[0]?.key ?? null };
  });
  return {
    signals: signals.length,
    rows,
    advice,
    families,
    bands,
    trades: base.trades.slice(-60).reverse().map(slim),
  };
}

import { summarize } from './simulate.js';
import { CHASE_CHOICES, CHASE_MINUTES } from '../options/chase.js';
import { round2 } from '../utils/money.js';

// The ladder tester: the entries the live trader would have taken on the saved real option prices, sold again and again with other
// profit ladders, so the ladder can be picked from data and not from one bad day. Each ladder is chosen on the older days only and then
// checked on the newest days it never saw; a ladder that does not hold up there is not recommended. The same replay also tries the
// anti-chase check (skip a buy whose premium has already run up from its recent low). Read-only: nothing live is changed by it.

export const BE_KEEP = 200; // "break-even": the first rung keeps ₹200, about the charges and slippage of a round trip, so the trade can no longer end in a loss
export const FIRST_RUNGS = [750, 1000, 1500, 2000, 2500, 3000, 3500];
export const RUNG_GAPS = [500, 750, 1000, 1500];
export const EARLY_BE = [1000, 1500, 2000]; // break-even rungs put in front of your own ladder
export const MIN_SPLIT_DAYS = 6; // fewer saved days than this cannot be split into "pick" and "check" days
export const MIN_FIT_TRADES = 8; // a ladder is picked only when the older days had at least this many trades
export const CHASE_LOOKBACKS = [CHASE_MINUTES, 30];
const MAX_ROWS = 8;
const BIG_WIN = 1000; // a trade that was this far up at its best and still ended in a loss is a "winner that turned into a loss"

const rs = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** First rung at `first` moves the stop to break-even, then a rung every `gap` keeps the rung below it: the stop sits one rung behind the best profit. */
export function rungLadder(first, gap) {
  const rows = [{ at: first, keep: BE_KEEP }];
  for (let i = 1; rows.length < MAX_ROWS; i++) rows.push({ at: first + i * gap, keep: first + (i - 1) * gap });
  return rows;
}

/** The ladders to try: yours, yours with a break-even rung in front, and a grid of first rung x gap per rung. */
export function candidates(current = []) {
  const yours = (current ?? []).map(({ at, keep }) => ({ at, keep }));
  const out = [{ key: 'current', family: 'current', label: 'Your ladder now', text: yours.length ? ladderWords(yours) : 'No profit lock: winners ride until the stop or the closing time.', steps: yours }];
  for (const first of EARLY_BE) {
    if (!yours.length || first >= yours[0].at || yours[0].keep <= BE_KEEP || yours.length >= MAX_ROWS) continue;
    const steps = [{ at: first, keep: BE_KEEP }, ...yours];
    out.push({ key: `be${first}`, family: 'early', first, label: `Yours + break-even at +${rs(first)}`, text: `At +${rs(first)} the stop moves to break-even (keeps ${rs(BE_KEEP)} for charges), then your ladder from +${rs(yours[0].at)} as now.`, steps });
  }
  for (const first of FIRST_RUNGS) {
    for (const gap of RUNG_GAPS) {
      const steps = rungLadder(first, gap);
      out.push({ key: `r${first}-${gap}`, family: 'grid', first, gap, label: `First rung +${rs(first)}, a rung every ${rs(gap)}`, text: `At +${rs(first)} the stop moves to break-even (keeps ${rs(BE_KEEP)}). Every ${rs(gap)} more profit it moves up one rung: +${rs(first + gap)} keeps ${rs(first)}, +${rs(first + 2 * gap)} keeps ${rs(first + gap)}, and so on, ${rs(gap)} behind the best.`, steps });
    }
  }
  return out;
}

/** A ladder in words. */
export function ladderWords(steps) {
  if (!steps?.length) return 'No profit lock.';
  const shown = steps.slice(0, 3).map((s) => `+${rs(s.at)} keeps ${rs(s.keep)}`).join(', ');
  return `${shown}${steps.length > 3 ? ` … +${rs(steps.at(-1).at)} keeps ${rs(steps.at(-1).keep)}` : ''}, then ${rs(steps.at(-1).at - steps.at(-1).keep)} behind the best.`;
}

/** The numbers of one set of trades: rupees after charges, win rate, how much of the best profit was kept, and winners that turned into losses. */
export function measure(trades) {
  const m = summarize(trades);
  const reached = trades.filter((t) => t.best > 0);
  const bestSum = reached.reduce((s, t) => s + t.best, 0);
  const keptSum = reached.reduce((s, t) => s + Math.max(t.gross, 0), 0);
  return {
    trades: m.trades,
    wins: m.wins,
    winRate: m.winRate,
    net: m.net,
    avgWin: m.avgWin,
    avgLoss: m.avgLoss,
    maxDrawdown: m.maxDrawdown,
    kept: bestSum > 0 ? Math.round((keptSum / bestSum) * 100) : null, // % of the best profit (before charges) that was still there at the sale
    gaveBack: reached.length ? round2((bestSum - keptSum) / reached.length) : null, // rupees a trade gave back from its best, on average
    reversed: trades.filter((t) => t.best >= BIG_WIN && t.net < 0).length,
    byExit: m.byExit,
  };
}

const split = (trades, trainEnd) => ({ all: measure(trades), fit: measure(trades.filter((t) => t.entryTime < trainEnd)), check: measure(trades.filter((t) => t.entryTime >= trainEnd)) });

/** For the grid, a ladder's "pick" score is the average of its own older-days result and its neighbours': a lucky spike next to poor neighbours does not win. */
function smoothScores(rows) {
  const at = new Map(rows.filter((r) => r.family === 'grid').map((r) => [`${r.first}|${r.gap}`, r]));
  const early = rows.filter((r) => r.family === 'early');
  for (const r of rows) {
    let near = [r];
    if (r.family === 'grid') {
      const fi = FIRST_RUNGS.indexOf(r.first);
      const gi = RUNG_GAPS.indexOf(r.gap);
      near = [[fi, gi], [fi - 1, gi], [fi + 1, gi], [fi, gi - 1], [fi, gi + 1]].map(([a, b]) => at.get(`${FIRST_RUNGS[a]}|${RUNG_GAPS[b]}`)).filter(Boolean);
    } else if (r.family === 'early') {
      const i = early.indexOf(r);
      near = [early[i - 1], r, early[i + 1]].filter(Boolean);
    }
    r.pickScore = round2(near.reduce((s, x) => s + x.fit.net, 0) / near.length);
  }
}

/**
 * Picks on the older days, checks on the newer: the best "pick" score among the ladders with enough trades on the older days. It is
 * recommended only when it beat your ladder on the older days and did at least as well on the newer days it never saw.
 */
export function recommend(rows, { splitOk }) {
  const current = rows.find((r) => r.key === 'current');
  if (!splitOk) return { verdict: 'short', text: `Fewer than ${MIN_SPLIT_DAYS} days of real option prices are saved, too few to pick on some days and check on others. Keep your ladder and run this again in a few days.` };
  const pool = rows.filter((r) => r.key !== 'current' && r.fit.trades >= MIN_FIT_TRADES).sort((a, b) => b.pickScore - a.pickScore || b.fit.net - a.fit.net);
  const pick = pool[0];
  if (!pick) return { verdict: 'few', text: `The older days had fewer than ${MIN_FIT_TRADES} trades, too few to pick a ladder. Keep yours.` };
  if (!(pick.fit.net > current.fit.net)) return { verdict: 'keep', key: 'current', text: 'No ladder beat yours on the older days. Keep your ladder.' };
  if (!(pick.check.net >= current.check.net)) return { verdict: 'keep', key: 'current', tried: pick.key, text: `"${pick.label}" did best on the older days, but on the newest days (which it never saw) it made ${rs(pick.check.net)} against ${rs(current.check.net)} for yours. It did not hold up, so keep your ladder.` };
  return { verdict: 'change', key: pick.key, text: `"${pick.label}" did best on the older days and also beat yours on the newest days it never saw: ${rs(pick.check.net)} against ${rs(current.check.net)}.` };
}

/** The anti-chase check on the same entries: every threshold, picked on the older days and checked on the newer ones against no check. */
export function recommendChase(rows, { splitOk }) {
  const off = rows.find((r) => r.key === 'off');
  if (!splitOk) return { verdict: 'short', text: 'Too few saved days to judge the check. Leave it as it is.' };
  const pool = rows.filter((r) => r.key !== 'off' && r.fit.trades >= MIN_FIT_TRADES).sort((a, b) => b.fit.net - a.fit.net);
  const pick = pool[0];
  if (!pick || !(pick.fit.net > off.fit.net)) return { verdict: 'off', key: 'off', text: 'Skipping spiked premiums did not help on the older days. Leave the check off.' };
  if (!(pick.check.net >= off.check.net)) return { verdict: 'off', key: 'off', tried: pick.key, text: `Skipping a premium over ${pick.pct}% above its ${pick.minutes}-minute low helped on the older days but not on the newest ones (${rs(pick.check.net)} against ${rs(off.check.net)} with no check). Leave it off.` };
  return { verdict: 'on', key: pick.key, text: `Skipping a buy when the premium is over ${pick.pct}% above its ${pick.minutes}-minute low helped on the older days and on the newest ones too: ${rs(pick.check.net)} against ${rs(off.check.net)} with no check.` };
}

const slimTrade = (t) => ({ side: t.side, technique: t.technique, entryTime: t.entryTime, exitTime: t.exitTime, strike: t.strike, lots: t.lots, entryPremium: t.entryPremium, best: t.best, gross: t.gross, net: t.net, reason: t.reason, rise: t.rise });

/**
 * @param signals    the entries the live trader would take (its patterns and combinations), with their stops
 * @param tradesFor  (signals, params) -> { trades, skips }: the study's trader with the live rules
 * @param trainEnd   the first moment of the newest days, which are kept back for the check
 * @param params     the study params; `steps` is your ladder now and `chase` your anti-chase setting now
 */
export async function runLadderTest({ signals, tradesFor, trainEnd, splitOk, params, onProgress = () => {}, yieldTurn = () => Promise.resolve() }) {
  const list = candidates(params.steps);
  const rows = [];
  for (const [n, c] of list.entries()) {
    if (n % 5 === 0) onProgress(`Trying ladders: ${n + 1}/${list.length}`);
    const { trades } = tradesFor(signals, { ...params, steps: c.steps, chase: params.chase ?? null });
    rows.push({ ...c, ...split(trades, trainEnd), list: c.key === 'current' ? trades.map(slimTrade) : undefined });
    await yieldTurn();
  }
  smoothScores(rows);
  const advice = recommend(rows, { splitOk });
  const chosen = rows.find((r) => r.key === (advice.verdict === 'change' ? advice.key : 'current'));

  // the anti-chase check, with the chosen ladder
  onProgress('Trying the anti-chase check');
  const chaseRows = [];
  const tryChase = async (key, chase, label) => {
    const { trades, skips } = tradesFor(signals, { ...params, steps: chosen.steps, chase });
    chaseRows.push({ key, pct: chase?.pct ?? 0, minutes: chase?.minutes ?? null, label, skipped: skips?.chase ?? 0, ...split(trades, trainEnd) });
    await yieldTurn();
  };
  await tryChase('off', null, 'No check');
  for (const minutes of CHASE_LOOKBACKS) for (const pct of CHASE_CHOICES) await tryChase(`c${pct}-${minutes}`, { pct, minutes }, `Skip if over ${pct}% above the ${minutes}-minute low`);
  const chaseAdvice = recommendChase(chaseRows, { splitOk });

  // how far the premium had already risen at each entry, so the spikes can be seen
  const current = rows.find((r) => r.key === 'current');
  const risen = (current.list ?? []).filter((t) => t.rise != null);
  const band = (lo, hi) => {
    const xs = risen.filter((t) => t.rise >= lo && t.rise < hi);
    return { from: lo, to: hi === Infinity ? null : hi, trades: xs.length, wins: xs.filter((t) => t.net > 0).length, net: round2(xs.reduce((s, t) => s + t.net, 0)) };
  };
  const riseBands = [band(-Infinity, 10), band(10, 20), band(20, 30), band(30, Infinity)].map((b) => ({ ...b, from: b.from === -Infinity ? null : b.from }));

  const order = (r) => (r.key === 'current' ? Infinity : r.pickScore);
  return {
    signals: signals.length,
    rows: rows.map(({ list: _l, ...r }) => r).sort((a, b) => order(b) - order(a)),
    advice,
    chosen: { key: chosen.key, label: chosen.label, steps: chosen.steps },
    chase: { rows: chaseRows, advice: chaseAdvice, now: params.chase ?? null },
    riseBands,
    currentTrades: (current.list ?? []).slice(-40).reverse(),
  };
}

import { AutoLog, Position } from '../models/index.js';
import { OptionHistoryStore } from '../market/optionHistory.js';
import { INDEXES, isOptionSymbol, optionLabel, parseOptionSymbol } from '../options/symbols.js';
import { istParts } from '../market/marketHours.js';
import { notFound } from '../utils/errors.js';
import { round2 } from '../utils/money.js';
import { loadRules } from '../models/TradeDefaults.js';

// Trade replay: one closed (or open) trade, share or option, minute by minute. For every minute it was held: the price, the profit or
// loss at the close, the best and worst inside the minute, where the profit ladder had put the stop, and (for an option) where the index
// was. Then a few plain lines on why it ended how it did. It reads saved candles and changes nothing.

const MIN = 60;

/** Entry and exit prices, quantity and direction of a position (closed or open). */
export function tradeShape(pos) {
  const long = pos.direction === 'LONG';
  const qty = long ? pos.buyQty || Math.abs(pos.netQty) : pos.sellQty || Math.abs(pos.netQty);
  const entry = long ? (pos.buyQty ? pos.buyValue / pos.buyQty : pos.avgPrice) : pos.sellQty ? pos.sellValue / pos.sellQty : pos.avgPrice;
  const closedQty = long ? pos.sellQty : pos.buyQty;
  const exit = closedQty ? (long ? pos.sellValue / pos.sellQty : pos.buyValue / pos.buyQty) : null;
  return { long, qty, entry: round2(entry), exit: exit == null ? null : round2(exit) };
}

/** Where the profit ladder keeps the stop once the best profit so far is `best` rupees: null below the first rung. */
export function lockAt(best, { steps = [], lockTrigger = null, lockAmount = null } = {}) {
  const rungs = (steps?.length ? steps : lockTrigger > 0 && lockAmount != null ? [{ at: lockTrigger, keep: lockAmount }] : []).filter((r) => r.at > 0).sort((a, b) => a.at - b.at);
  const rung = rungs.filter((r) => best >= r.at).at(-1);
  return rung ? round2(Math.max(rung.keep, best - (rung.at - rung.keep))) : null;
}

/**
 * The minute-by-minute rows of a trade.
 * @param bars       1-minute candles of the traded instrument (any range, oldest first)
 * @param indexBars  for an option, the index's 1-minute candles (else null)
 * @param shape      tradeShape(position)
 * @param from, to   epoch seconds the trade was opened and closed (to = now for an open trade)
 * @param ladder     { steps, lockTrigger, lockAmount } from the position
 * @param hardStop   the premium (or share price) of the hard stop order, or null
 */
export function replayRows({ bars, indexBars = null, shape, from, to, ladder = {}, hardStop = null }) {
  const { long, qty, entry } = shape;
  const d = long ? 1 : -1;
  const pnl = (price) => round2(d * (price - entry) * qty);
  const start = from - (from % MIN);
  const end = to - (to % MIN);
  const idx = new Map((indexBars || []).map((b) => [b.time, b]));
  const rows = [];
  let best = -Infinity;
  let worst = Infinity;
  for (const b of bars) {
    if (b.time < start || b.time > end) continue;
    const hi = pnl(long ? b.high : b.low);
    const lo = pnl(long ? b.low : b.high);
    best = Math.max(best, hi);
    worst = Math.min(worst, lo);
    const ix = idx.get(b.time);
    rows.push({
      time: b.time,
      minute: rows.length + 1,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      pnl: pnl(b.close),
      pnlHigh: hi,
      pnlLow: lo,
      best: round2(best),
      worst: round2(worst),
      lock: lockAt(best, ladder),
      index: ix ? round2(ix.close) : null,
    });
  }
  return { rows, hardStopPnl: hardStop == null ? null : pnl(hardStop) };
}

const hm = (t) => {
  const m = istParts(new Date(t * 1000)).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const rs = (n) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;

/**
 * Plain lines on why the trade ended as it did, from its rows: each { tone: 'up' | 'down' | 'warn' | 'muted', text }.
 * `limit` is the loss limit for one trade (0 = none); `day` for an option is { open, entry, exit } of the index.
 */
export function diagnose({ rows, net, charges = 0, limit = 0, side = null, day = null, exitReason = null }) {
  const out = [];
  if (!rows.length) return [{ tone: 'muted', text: 'No minute candles are saved for this trade, so it cannot be replayed.' }];
  const peak = rows.reduce((a, r) => (r.pnlHigh > a.pnlHigh ? r : a), rows[0]);
  const trough = rows.reduce((a, r) => (r.pnlLow < a.pnlLow ? r : a), rows[0]);
  const firstFive = rows.slice(0, 5);
  const bestEarly = Math.max(...firstFive.map((r) => r.pnlHigh));
  if (net < 0 && peak.pnlHigh >= 1000) out.push({ tone: 'warn', text: `It was up ${rs(peak.pnlHigh)} at ${hm(peak.time)} (minute ${peak.minute}) and still ended at a loss. That is an exit problem, not an entry problem: a ladder rung at or under +${rs(Math.floor(peak.pnlHigh / 500) * 500 || 500)} would have kept part of it. Try Research > Ladder tester.` });
  else if (net < 0 && peak.pnlHigh < 300) out.push({ tone: 'down', text: `Wrong from the start: it was never more than ${rs(Math.max(peak.pnlHigh, 0))} in profit. The entry itself was the problem (late, or against the move).` });
  else if (net < 0) out.push({ tone: 'down', text: `Best was ${rs(peak.pnlHigh)} at ${hm(peak.time)}, too small to reach your ladder, then it turned and hit the stop.` });
  if (net > 0 && peak.pnlHigh > 0 && net < peak.pnlHigh * 0.4) out.push({ tone: 'warn', text: `Won ${rs(net)} but was up ${rs(peak.pnlHigh)} at ${hm(peak.time)}: the exit gave back ${Math.round((1 - net / peak.pnlHigh) * 100)}% of the best.` });
  if (net > 0 && peak.pnlHigh > 0 && net >= peak.pnlHigh * 0.4) out.push({ tone: 'up', text: `A good trade: kept ${rs(net)} of a best of ${rs(peak.pnlHigh)}.` });
  if (bestEarly < 200 && trough.minute <= 5 && net < 0) out.push({ tone: 'down', text: `The worst point came in minute ${trough.minute}: the price turned against it right after the buy.` });
  if (limit > 0 && net < -limit - 1) out.push({ tone: 'down', text: `Lost ${rs(net)} after charges, more than your ${rs(limit)} limit. Until 4 Nov 2026 the hard stop sat at 1.3 times the limit; it now sits at the limit itself, charges included.` });
  if (day && side && day.open > 0) {
    const move = ((day.entry - day.open) / day.open) * 100;
    const against = side === 'PE' ? move > 0.15 : side === 'CE' ? move < -0.15 : false;
    if (against) out.push({ tone: 'warn', text: `Bought a ${side === 'PE' ? 'put' : 'call'} while the index was ${move > 0 ? 'up' : 'down'} ${Math.abs(move).toFixed(2)}% on the day: against the day's direction. The "With the day only" switch in Options > Auto skips these.` });
    if (day.exit != null) out.push({ tone: 'muted', text: `The index went from ${day.entry} to ${day.exit} while it was held (${round2(day.exit - day.entry) >= 0 ? '+' : ''}${round2(day.exit - day.entry)} points).` });
  }
  if (charges > 0) out.push({ tone: 'muted', text: `Charges were ${rs(charges)}.` });
  if (exitReason) out.push({ tone: 'muted', text: `It ended by: ${exitReason}.` });
  return out;
}

/** Loads one of the user's positions and everything the replay needs. */
export class ReplayService {
  constructor({ market, engine, store = new OptionHistoryStore() }) {
    this.market = market;
    this.engine = engine;
    this.store = store;
  }

  async #optionBars(symbol, day) {
    const today = this.engine?.marketStatus?.().istDate;
    const provider = this.market.provider;
    const tries = [
      () => (day === today ? provider?.getTodayOptionCandles?.(symbol, 1) : null),
      () => this.store.read(symbol, day, day),
      () => provider?.getOptionCandlesBetween?.(symbol, 1, day, day),
      () => this.market.getCandles(symbol, '1m'),
    ];
    for (const t of tries) {
      try {
        const got = await t();
        if (got?.length) return got;
      } catch {
        // try the next source
      }
    }
    return [];
  }

  async replay(userId, positionId) {
    const pos = await Position.findOne({ _id: positionId, user: userId }).lean();
    if (!pos) throw notFound('That trade was not found');
    const log = await AutoLog.findOne({ user: userId, position: pos._id }).lean();
    const option = isOptionSymbol(pos.symbol);
    const day = pos.tradingDay;
    const from = Math.floor(new Date(pos.openedAt).getTime() / 1000);
    const to = Math.floor(new Date(pos.closedAt ?? Date.now()).getTime() / 1000);
    const shape = tradeShape(pos);
    const bars = option ? await this.#optionBars(pos.symbol, day) : await this.market.getMinutes(pos.symbol, day).catch(() => []);
    const o = option ? parseOptionSymbol(pos.symbol) : null;
    const indexSym = o ? INDEXES[o.index]?.symbol : null;
    const indexBars = indexSym ? await this.market.getMinutes(indexSym, day).catch(() => []) : null;
    const ladder = { steps: pos.lockSteps, lockTrigger: pos.lockTrigger, lockAmount: pos.lockAmount };
    const { rows, hardStopPnl } = replayRows({ bars, indexBars, shape, from, to, ladder, hardStop: log?.stopLoss ?? null });
    const net = round2((pos.realizedPnl || 0) - (pos.charges || 0));
    let indexDay = null;
    if (indexBars?.length) {
      const sameDay = indexBars.filter((b) => istParts(new Date(b.time * 1000)).dateKey === day);
      const at = (t) => sameDay.filter((b) => b.time <= t).at(-1)?.close ?? null;
      if (sameDay.length) indexDay = { open: sameDay[0].open, entry: round2(at(from) ?? sameDay[0].open), exit: pos.closedAt ? round2(at(to)) : null };
    }
    const limit = (await loadRules(userId, option ? 'OPT' : 'EQ', o ? { index: o.index } : {}).catch(() => null))?.stopLoss ?? 0;
    const exitLabel = log?.outcome?.exitReason ?? null;
    return {
      position: {
        id: pos._id,
        symbol: pos.symbol,
        label: option ? optionLabel(pos.symbol) : pos.symbol,
        segment: pos.segment,
        status: pos.status,
        direction: pos.direction,
        qty: shape.qty,
        entry: shape.entry,
        exit: shape.exit,
        openedAt: pos.openedAt,
        closedAt: pos.closedAt ?? null,
        gross: round2(pos.realizedPnl || 0),
        charges: round2(pos.charges || 0),
        net,
        minutes: Math.max(1, Math.round((to - from) / 60)),
      },
      entry: log
        ? {
            source: log.detail?.manual || log.source === 'MANUAL' ? 'manual' : 'auto',
            setup: log.setup ?? null,
            score: log.score ?? null,
            pattern: log.detail?.pattern ?? null,
            stopLoss: log.stopLoss ?? null,
            stopSpot: log.detail?.stopSpot ?? null,
            stopNote: log.detail?.stopNote ?? null,
            entrySpot: log.detail?.entrySpot ?? null,
            lots: log.detail?.lots ?? null,
            iv: log.detail?.iv ?? null,
            probation: Boolean(log.detail?.probation),
            target1: log.target1 ?? null,
            checks: log.card?.checks ?? [],
            gates: log.card?.gates ?? [],
            outcome: log.outcome ?? null,
          }
        : null,
      ladder: (pos.lockSteps?.length ? pos.lockSteps : pos.lockTrigger ? [{ at: pos.lockTrigger, keep: pos.lockAmount }] : []).map((r) => ({ at: r.at, keep: r.keep })),
      hardStopPnl,
      rows,
      index: indexSym ? { symbol: indexSym, day: indexDay } : null,
      diagnosis: diagnose({ rows, net, charges: pos.charges || 0, limit, side: o?.type ?? null, day: indexDay, exitReason: exitLabel }),
    };
  }
}

import { AutoLog, Position, Trade, TradeDefaults } from '../models/index.js';
import { OptionHistoryStore } from '../market/optionHistory.js';
import { istParts } from '../market/marketHours.js';
import { INDEXES, optionLabel, parseOptionSymbol } from '../options/symbols.js';
import { rulesFor } from '../models/TradeDefaults.js';
import { HARD_STOP_MULT } from '../options/plan.js';

// Trade replay: one closed (or open) trade, minute by minute. What the trade was worth at the end of each minute it was held, its best and
// worst point inside the minute, what the index did meanwhile, why it was bought (the pattern or combination and its checks) and how it ended.
// Every number comes from saved 1-minute candles of that contract (or stock); nothing is estimated. Without candles the replay says so.

const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;
const minuteOf = (date) => Math.floor(new Date(date).getTime() / 60000) * 60;
const clock = (sec) => {
  const { minutes } = istParts(new Date(sec * 1000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const rs = (n) => `${n < 0 ? '-' : '+'}₹${Math.abs(r0(n)).toLocaleString('en-IN')}`;

const EXIT_WORDS = {
  STOP: 'the stop (the index closed a minute beyond the chart level, or the premium hit the hard stop)',
  LOCK: 'the profit lock',
  TARGET: 'the target',
  TRAIL: 'the trailing stop',
  BREAKEVEN: 'the break-even stop',
  TIME: 'the exit time',
  SQUARE_OFF: 'the 15:15 square-off',
  MANUAL: 'your own exit',
};

/**
 * The minute-by-minute picture of one trade. Pure, so it is tested without a database.
 * @param position  { symbol, segment, direction, buyQty, sellQty, buyValue, sellValue, realizedPnl, charges, openedAt, closedAt, status }
 * @param candles   1-minute candles of what was traded (the option contract, or the stock), oldest first: { time, open, high, low, close }
 * @param index1    1-minute candles of the index (options only), or []
 * @param fills     executions: [{ side, role, qty, price, executedAt }]
 * @param log       the auto trader's log row for this trade, or null for a trade made by hand
 * @param rules     the options (or shares) rules: { stopLoss, steps, lockOn }
 * @param now       for an open trade, where the replay ends
 */
export function buildReplay({ position: p, candles = [], index1 = [], fills = [], log = null, rules = null, now = new Date() }) {
  const long = p.direction !== 'SHORT';
  const qty = Math.max(p.buyQty || 0, p.sellQty || 0);
  const entry = long ? (p.buyQty ? p.buyValue / p.buyQty : null) : p.sellQty ? p.sellValue / p.sellQty : null;
  const exit = p.status === 'CLOSED' ? (long ? (p.sellQty ? p.sellValue / p.sellQty : null) : p.buyQty ? p.buyValue / p.buyQty : null) : null;
  const opened = minuteOf(p.openedAt);
  const closedAt = p.closedAt ? new Date(p.closedAt) : now;
  const closed = minuteOf(closedAt);
  const dir = long ? 1 : -1;
  const pnl = (price) => r0(dir * (price - entry) * qty);
  const held = candles.filter((c) => c.time >= opened && c.time <= closed);
  const idx = new Map(index1.map((c) => [c.time, c]));
  const indexAtEntry = idx.get(opened)?.open ?? null;

  const minutes = held.map((c, n) => {
    // the first minute is counted from the fill, the last up to the exit: the rest of those minutes did not belong to the trade
    const first = n === 0;
    const last = c.time === closed && exit != null;
    const close = last ? exit : c.close;
    const best = long ? c.high : c.low;
    const worst = long ? c.low : c.high;
    const ix = idx.get(c.time);
    return {
      time: c.time,
      clock: clock(c.time),
      minute: n + 1,
      price: r2(close),
      pnl: pnl(close),
      best: pnl(first ? (long ? Math.max(best, entry) : Math.min(best, entry)) : best),
      worst: pnl(first ? (long ? Math.min(worst, entry) : Math.max(worst, entry)) : worst),
      index: ix ? r2(ix.close) : null,
      indexMove: ix && indexAtEntry != null ? r2(ix.close - indexAtEntry) : null,
    };
  });

  const finalNet = p.status === 'CLOSED' ? r0(p.realizedPnl - p.charges) : minutes.length ? minutes.at(-1).pnl - r0(p.charges) : null;
  const peak = minutes.reduce((a, m) => (a == null || m.best > a.best ? m : a), null);
  const trough = minutes.reduce((a, m) => (a == null || m.worst < a.worst ? m : a), null);
  const inProfit = minutes.filter((m) => m.pnl > 0).length;
  const summary = minutes.length
    ? {
        minutes: minutes.length,
        first: minutes[0].pnl,
        peak: peak.best,
        peakAt: peak.clock,
        peakMinute: peak.minute,
        trough: trough.worst,
        troughAt: trough.clock,
        troughMinute: trough.minute,
        gaveBack: peak.best > 0 && finalNet != null ? r0(peak.best - finalNet) : 0,
        minutesInProfit: inProfit,
        final: finalNet,
        charges: r0(p.charges),
      }
    : null;

  const steps = (rules?.lockOn !== false && rules?.steps?.length ? rules.steps : []) ?? [];
  const firstLock = steps[0]?.at ?? null;
  const limit = rules?.stopLoss ?? 0;
  const lessons = [];
  if (summary) {
    if (summary.peak > 0 && finalNet < 0) {
      lessons.push(`It was up ${rs(summary.peak)} at ${summary.peakAt} (minute ${summary.peakMinute}) and still ended ${rs(finalNet)}.${firstLock && summary.peak < firstLock ? ` Your profit ladder only starts at ${rs(firstLock)}, so nothing protected that profit. Research > Ladder tester shows whether an earlier first step (like +₹1,500 keeps ₹200) would have saved trades like this one.` : ''}`);
    }
    if (limit > 0 && finalNet < -limit * 1.05) {
      lessons.push(`It lost ${rs(finalNet)}, more than your ${rs(-limit).replace('-', '')} limit for one trade. Before 4 Nov the hard premium stop sat at ${HARD_STOP_MULT} times the limit (₹${r0(limit * HARD_STOP_MULT).toLocaleString('en-IN')}) plus charges; it now sits at the limit less charges ("Never lose more than my limit" in Account > Limits).`);
    }
    if (summary.first < 0 && summary.peak <= 0) lessons.push('It was never in profit, not even in the first minute: the entry came at the end of the move, or straight into a turn.');
    if (summary.troughMinute <= 3 && summary.trough < 0 && finalNet < 0) lessons.push(`The worst came within the first ${summary.troughMinute} minute${summary.troughMinute > 1 ? 's' : ''}: buying after a spike often looks like this (Research > Already moved? tests a limit for it).`);
    if (finalNet > 0 && summary.gaveBack > Math.max(500, finalNet)) lessons.push(`It ended ${rs(finalNet)} but had been ${rs(summary.peak)}: ${rs(summary.gaveBack).replace('+', '')} was given back.`);
  }
  if (!candles.length) lessons.push('No 1-minute candles of this contract are saved for that day, so the minute-by-minute path cannot be drawn. Option prices are saved each evening after 15:40 while the server runs (Research > Saved data), and kept 30 days.');

  const o = parseOptionSymbol(p.symbol);
  const why = log
    ? {
        source: log.detail?.manual ? 'Bought by hand' : log.setup || 'Auto trader',
        score: log.score ?? null,
        trigger: log.detail?.trigger ?? null,
        checks: (log.card?.checks || []).map((c) => ({ label: c.label, ok: c.ok ?? (c.max ? c.points >= c.max / 2 : null), text: c.note || c.text || null })),
        gates: (log.card?.gates || []).map((g) => ({ label: g.label, ok: g.ok, text: g.note || null })),
        stopNote: log.detail?.stopNote ?? null,
        stopSpot: log.detail?.stopSpot ?? null,
        entrySpot: log.detail?.entrySpot ?? log.detail?.spot ?? null,
        iv: log.detail?.iv ?? null,
        plannedMaxLoss: log.detail?.maxLoss ?? null,
        worstCase: log.detail?.worstCase ?? null,
        exitReason: log.outcome?.exitReason ?? null,
        exitWords: EXIT_WORDS[log.outcome?.exitReason] ?? null,
      }
    : null;

  return {
    id: String(p._id ?? ''),
    symbol: p.symbol,
    label: o ? optionLabel(p.symbol) : p.symbol,
    segment: p.segment,
    kind: o ? (o.type === 'CE' ? 'Call' : 'Put') : long ? 'Bought shares' : 'Sold shares first',
    day: p.tradingDay,
    status: p.status,
    qty,
    entry: entry != null ? r2(entry) : null,
    exit: exit != null ? r2(exit) : null,
    openedAt: p.openedAt,
    closedAt: p.closedAt ?? null,
    index: o ? o.index ?? 'NIFTY' : null,
    indexAtEntry,
    stopSpot: why?.stopSpot ?? null,
    lockFrom: firstLock,
    limit,
    summary,
    minutes,
    fills: fills.map((f) => ({ side: f.side, role: f.role || 'ENTRY', qty: f.qty, price: r2(f.price), at: f.executedAt, clock: clock(Math.floor(new Date(f.executedAt).getTime() / 1000)) })),
    why,
    lessons,
    source: candles.length ? 'Saved 1-minute candles of what was traded' : 'none',
  };
}

/** Reads what one trade needs and builds its replay. Returns null when the trade is not the user's. */
export async function tradeReplay({ userId, positionId, market, optionStore = new OptionHistoryStore(), now = new Date() }) {
  const p = await Position.findOne({ _id: positionId, user: userId }).lean().catch(() => null);
  if (!p) return null;
  const day = p.tradingDay;
  const o = parseOptionSymbol(p.symbol);
  const today = istParts(now).dateKey;
  let candles = [];
  let index1 = [];
  const onDay = (list) => list.filter((c) => istParts(new Date(c.time * 1000)).dateKey === day);
  if (o) {
    candles = await optionStore.read(p.symbol, day, day).catch(() => []);
    if (!candles.length && day === today) candles = onDay((await Promise.resolve(market.provider?.getTodayOptionCandles?.(p.symbol, 1)).catch(() => [])) ?? []);
    const idx = INDEXES[o.index] ?? INDEXES.NIFTY;
    index1 = onDay(await market.getMinutes(idx.symbol, day).catch(() => []));
  } else {
    candles = onDay(await market.getMinutes(p.symbol, day).catch(() => []));
  }
  const [fills, log, defaults] = await Promise.all([
    Trade.find({ user: userId, position: p._id }).sort({ executedAt: 1 }).lean(),
    AutoLog.findOne({ user: userId, position: p._id }).lean(),
    TradeDefaults.findOne({ user: userId }).lean(),
  ]);
  const rules = rulesFor(defaults, o ? 'OPT' : 'EQ', { index: o?.index ?? null });
  return buildReplay({ position: p, candles, index1, fills, log, rules, now });
}

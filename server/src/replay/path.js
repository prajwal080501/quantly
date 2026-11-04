import { LOCK_CHARGES_MULT, roundTripCharges } from '../services/charges.js';
import { round2, roundToTick } from '../utils/money.js';

// A closed (or open) trade played back one minute at a time: the price, the open P&L, the stop as it moved and the moments that mattered.
// Everything here is rebuilt from 1-minute candles, so it is a close picture of what happened, not the tick-by-tick record:
// the live engine checks every tick, so a stop can move a few seconds earlier or later than shown.

const STEP_KEEP = 0.8; // as the order engine: past a target step the stop goes this share of the way from entry to it
const minuteOf = (sec) => sec - (sec % 60);
const rupees = (n) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;

/**
 * The minutes of a trade, from the minute it was entered to the minute it was closed.
 * @param candles   1-minute candles of what was traded (a share, or the option contract), oldest first: { time, open, high, low, close }
 * @param long      bought first (true) or sold first
 * @param avg       average entry price
 * @param qty       shares or option units (lots times lot size)
 * @param entryTime entry, epoch seconds
 * @param exitTime  exit (or now for an open trade), epoch seconds
 * @param exitPrice the real exit price; the last minute's P&L uses it
 */
export function minuteRows({ candles, long, avg, qty, entryTime, exitTime, exitPrice = null }) {
  const from = minuteOf(entryTime);
  const to = minuteOf(exitTime);
  const d = long ? 1 : -1;
  const pnlAt = (price) => round2(d * (price - avg) * qty);
  const rows = candles
    .filter((c) => c.time >= from && c.time <= to)
    .map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      pnl: pnlAt(c.close),
      best: pnlAt(long ? c.high : c.low),
      worst: pnlAt(long ? c.low : c.high),
    }));
  if (rows.length && exitPrice != null && rows.at(-1).time === to) {
    const last = rows.at(-1);
    last.close = exitPrice;
    last.pnl = pnlAt(exitPrice);
    last.best = Math.max(last.best, last.pnl);
    last.worst = Math.min(last.worst, last.pnl);
  }
  const start = rows.length ? rows[0].time : from;
  rows.forEach((r) => {
    r.min = Math.round((r.time - start) / 60) + 1; // the first minute is minute 1
  });
  return rows;
}

/**
 * The price stop of the order engine, replayed minute by minute: the first stop, then the rupee lock, the profit ladder, the trailing %
 * and the target steps, each moving the stop only towards profit. Writes `stop` on each row and returns the moments it moved.
 * @param exits { stopLoss, lockSteps, lockTrigger, lockAmount, lockRatio, trailPct, stepPrices, segment }
 */
export function replayPriceStop(rows, { long, avg, qty, exits = {} }) {
  const events = [];
  let stop = exits.stopLoss ?? null;
  const floorPer = (LOCK_CHARGES_MULT * roundTripCharges({ qty, price: avg, segment: exits.segment ?? 'EQ' })) / qty;
  const chargesFloor = roundToTick(long ? avg + floorPer : avg - floorPer);
  const lockStop = (w) => (long ? Math.max(w, chargesFloor) : Math.min(w, chargesFloor));
  const steps = exits.lockSteps || [];
  let rungNow = -1;
  let lockOn = false;
  for (const r of rows) {
    const ltp = long ? r.high : r.low;
    const profit = (long ? ltp - avg : avg - ltp) * qty;
    const wants = [];
    let why = null;
    if (exits.trailPct != null) wants.push({ at: roundToTick(long ? ltp * (1 - exits.trailPct / 100) : ltp * (1 + exits.trailPct / 100)), why: `trailing ${exits.trailPct}% behind the price` });
    if (exits.lockTrigger != null && profit >= exits.lockTrigger) {
      const locked = exits.lockRatio != null ? exits.lockAmount + exits.lockRatio * (profit - exits.lockTrigger) : Math.max(exits.lockAmount, profit - (exits.lockTrigger - exits.lockAmount));
      wants.push({ at: lockStop(roundToTick(long ? avg + locked / qty : avg - locked / qty)), why: `profit reached ${rupees(exits.lockTrigger)}, so the stop locks ${rupees(locked)}`, lock: true });
    }
    const k = steps.reduce((acc, s, i) => (profit >= s.at ? i : acc), -1);
    if (k >= 0) {
      const s = steps[k];
      const keep = Math.max(s.keep, profit - (s.at - s.keep));
      wants.push({ at: lockStop(roundToTick(long ? avg + keep / qty : avg - keep / qty)), why: `ladder row ${k + 1}: profit reached ${rupees(s.at)}, so the stop keeps at least ${rupees(s.keep)}`, rung: k });
    }
    for (const step of exits.stepPrices || []) {
      if (long ? ltp > step : ltp < step) wants.push({ at: lockStop(roundToTick(avg + STEP_KEEP * (step - avg))), why: `price passed the target step ${step}` });
    }
    const valid = wants.filter((w) => (long ? w.at < ltp : w.at > ltp));
    if (valid.length) {
      const best = valid.reduce((a, b) => (long ? (b.at > a.at ? b : a) : b.at < a.at ? b : a));
      if (stop == null || (long ? best.at > stop : best.at < stop)) {
        stop = best.at;
        why = best.why;
        const firstLock = best.lock && !lockOn;
        const newRung = best.rung != null && best.rung > rungNow;
        if (best.lock) lockOn = true;
        if (best.rung != null) rungNow = Math.max(rungNow, best.rung);
        // a trailing stop moves nearly every minute: only the first move and each new ladder row are worth a line
        if (firstLock || newRung || !events.some((e) => e.kind === 'stop')) events.push({ time: r.time, kind: 'stop', price: stop, keeps: round2((long ? stop - avg : avg - stop) * qty), text: `Stop moved to ${stop}: ${why}` });
      }
    }
    r.stop = stop;
  }
  return events;
}

/**
 * The index stop of the options trader, replayed on the index's 1-minute candles: the chart stop, the break-even move and the trail,
 * all in index points. The trader exits when a 1-minute candle of the index CLOSES beyond it. Writes `spot` and `spotStop` on each row.
 * @param index { candles, long, entrySpot, stopSpot, breakEven (points, 0 = off), trail: { points, start } | null }
 */
export function replayIndexStop(rows, index) {
  if (!index?.candles?.length || index.entrySpot == null) return [];
  const by = new Map(index.candles.map((c) => [c.time, c]));
  const { long, entrySpot } = index;
  let stopSpot = index.stopSpot ?? null;
  let best = entrySpot;
  let beDone = false;
  let trailOn = false;
  const events = [];
  const better = (level) => stopSpot == null || (long ? level > stopSpot : level < stopSpot);
  for (const r of rows) {
    const c = by.get(r.time);
    if (!c) continue;
    r.spot = c.close;
    if (stopSpot != null && (long ? c.close <= stopSpot : c.close >= stopSpot)) {
      if (!events.some((e) => e.kind === 'spotHit')) events.push({ time: r.time, kind: 'spotHit', price: stopSpot, text: `The index closed at ${c.close}, past its stop of ${stopSpot}: the chart said the idea was wrong` });
    }
    best = long ? Math.max(best, c.high) : Math.min(best, c.low);
    const gained = long ? best - entrySpot : entrySpot - best;
    if (index.breakEven > 0 && gained >= index.breakEven && better(entrySpot)) {
      stopSpot = roundToTick(entrySpot);
      if (!beDone) events.push({ time: r.time, kind: 'breakEven', price: stopSpot, text: `The index moved ${index.breakEven} points your way: its stop went to the entry level ${stopSpot} (break-even)` });
      beDone = true;
    }
    if (index.trail && gained >= index.trail.start) {
      const level = roundToTick(long ? best - index.trail.points : best + index.trail.points);
      if (better(level)) {
        stopSpot = level;
        if (!trailOn) events.push({ time: r.time, kind: 'trail', price: level, text: `The index gained ${index.trail.start} points: its stop now trails ${index.trail.points} points behind the best (${level})` });
        trailOn = true;
      }
    }
    r.spotStop = stopSpot;
  }
  return events;
}

/** The peak, the low, the give-back and how the time split between profit and loss. */
export function pathSummary(rows) {
  if (!rows.length) return null;
  let peak = rows[0];
  let trough = rows[0];
  for (const r of rows) {
    if (r.best > peak.best) peak = r;
    if (r.worst < trough.worst) trough = r;
  }
  const last = rows.at(-1);
  const firstRed = rows.find((r) => r.pnl < 0);
  const firstGreen = rows.find((r) => r.pnl > 0);
  return {
    minutes: rows.length,
    final: last.pnl,
    peak: round2(Math.max(0, peak.best)),
    peakTime: peak.best > 0 ? peak.time : null,
    peakMin: peak.best > 0 ? peak.min : null,
    trough: round2(Math.min(0, trough.worst)),
    troughTime: trough.worst < 0 ? trough.time : null,
    troughMin: trough.worst < 0 ? trough.min : null,
    gaveBack: round2(Math.max(0, peak.best) - last.pnl),
    minutesUp: rows.filter((r) => r.pnl > 0).length,
    minutesDown: rows.filter((r) => r.pnl < 0).length,
    firstRedMin: firstRed?.min ?? null,
    firstGreenMin: firstGreen?.min ?? null,
  };
}

const signed = (n) => `${n >= 0 ? '+' : '-'}${rupees(n)}`;
const clock = (sec) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sec * 1000));

/**
 * Plain sentences about the trade: what the price did, why the stop did or did not protect it, and why the loss was the size it was.
 * Only facts read off the minutes and the plan; no advice that the numbers do not show.
 */
export function lessons({ summary, net, gross, charges, plannedRisk = null, exits = {}, qty, lots = null, lotSize = null, segment = 'EQ', exitLabel = null, stopEvents = [] }) {
  const out = [];
  if (!summary) return out;
  const s = summary;
  if (s.peak > 0 && s.peakTime) {
    if (gross < 0) out.push({ tone: 'down', text: `It was up ${signed(s.peak)} at ${clock(s.peakTime)} (${s.peakMin} min after entry), then turned and closed ${signed(gross)} before charges: ${rupees(s.gaveBack)} given back from the best point.` });
    else if (s.gaveBack > Math.max(200, 0.4 * s.peak)) out.push({ tone: 'warn', text: `The best point was ${signed(s.peak)} at ${clock(s.peakTime)}; it closed at ${signed(gross)}, so ${rupees(s.gaveBack)} of the open profit was given back.` });
    else out.push({ tone: 'up', text: `The best point was ${signed(s.peak)} at ${clock(s.peakTime)} and it closed at ${signed(gross)}: most of the move was kept.` });
  } else if (gross < 0) {
    out.push({ tone: 'down', text: `It never showed a profit: it went against you from the first minute${s.troughTime ? `, worst ${signed(s.trough)} at ${clock(s.troughTime)}` : ''}. The entry came after the move, or the move did not start.` });
  }
  const first = exits.lockSteps?.[0]?.at ?? exits.lockTrigger ?? null;
  const moved = stopEvents.some((e) => e.kind === 'stop' && e.keeps > 0);
  if (first != null && gross < 0 && s.peak > 0 && s.peak < first) {
    out.push({ tone: 'warn', text: `Your profit lock starts at ${signed(first)}. The best point was ${signed(s.peak)}, under that, so the stop never moved up to protect the profit.` });
  } else if (moved && gross <= 0) {
    out.push({ tone: 'warn', text: 'The stop had moved into profit, but the exit still filled at a loss: the price fell through the stop faster than it could fill.' });
  } else if (first == null && s.peak > 0 && gross < 0 && !exits.trailPct) {
    out.push({ tone: 'warn', text: 'This trade had no profit lock, so nothing moved the stop up while it was in profit.' });
  }
  if (plannedRisk != null && plannedRisk > 0 && gross < 0) {
    const over = -gross - plannedRisk;
    if (over > Math.max(100, 0.1 * plannedRisk)) out.push({ tone: 'down', text: `The plan risked ${rupees(plannedRisk)}, the loss was ${rupees(gross)} before charges: ${rupees(over)} more, because the exit filled beyond the stop${exitLabel ? ` (${exitLabel})` : ''}.` });
    else out.push({ tone: 'muted', text: `The loss (${rupees(gross)} before charges) stayed within the planned risk of ${rupees(plannedRisk)}.` });
  }
  if (segment === 'OPT' && qty) out.push({ tone: 'muted', text: `Size: ${lots ? `${lots} lot${lots > 1 ? 's' : ''} of ${lotSize} = ` : ''}${qty} units, so every ₹1 move in the premium is ${rupees(qty)} of P&L.` });
  else if (qty) out.push({ tone: 'muted', text: `Size: ${qty} shares, so every ₹1 move in the price is ${rupees(qty)} of P&L.` });
  if (charges > 0 && net < 0 && Math.abs(net) > 0) out.push({ tone: 'muted', text: `Charges were ${rupees(charges)} of the ${rupees(net)} net loss.` });
  else if (charges > 0 && gross > 0 && charges >= 0.3 * gross) out.push({ tone: 'warn', text: `Charges (${rupees(charges)}) took ${Math.round((charges / gross) * 100)}% of the gross profit.` });
  return out;
}

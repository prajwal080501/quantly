import { bsPrice, impliedVol } from './pricing.js';
import { parseOptionSymbol, yearsToExpiry } from './symbols.js';
import { roundTripCharges } from '../services/charges.js';
import { roundToTick, round2 } from '../utils/money.js';

// Turns "the Nifty chart says buy a call, with the stop at 24350" into an option order: how many lots, and the stops.
// The stop is read from the chart: the Nifty level where the idea is proven wrong, repriced to a premium with Black-Scholes from the
// live premium's own implied volatility. Lots are sized so that loss, at that level, stays within the user's loss limit (Account tab).
// A hard premium stop sits behind it for a fast gap. There are no targets and no trailing stop: the order engine puts the user's
// profit lock on the position when it fills.

export const MAX_LOSS_PCT = 0.3; // if the chart stop would cost more than this share of the premium, the trade is too expensive to take
export const MIN_SIZING_LOSS_PCT = 0.05; // the loss at the chart stop used for sizing is never counted as smaller than this share of the premium
export const HARD_STOP_MULT = 1; // the hard premium stop loses at most the loss limit itself (charges included): it used to sit at 1.3 times it, which let a 3,000 limit lose 3,955
export const MAX_IV = 0.35; // above this the premium is very expensive and usually deflates fast
const MS_YEAR = 365 * 24 * 3600 * 1000;
const WAIT_MS = 20 * 60000; // reprice about 20 minutes ahead: the stop is usually hit a little later than now

/**
 * @param read        one side of readNifty(): { type, stop: { price, note } }
 * @param market      the shared indicator set (readMarket): spot price
 * @param contract    { symbol, strike, type, expiry, lotSize }
 * @param premium     live premium of the contract (₹ per unit)
 * @param settings    OptionSettings (budget, maxLots)
 * @param rules       the user's options rules from the Account tab: { stopLoss (the most one trade may lose), lockStart, lockGap }
 * @param available   rupees free in the paper wallet
 * @param spentBudget premium money already tied up in open option trades
 * @returns {{ plan } | { skipped: string }}
 */
export function planTrade({ read, market: m, contract, premium, settings, rules, available, spentBudget = 0, now = new Date(), lots: wantLots = null }) {
  const o = parseOptionSymbol(contract.symbol);
  if (!o || !(premium > 0)) return { skipped: 'no live premium for the contract' };
  const t = yearsToExpiry(o.expiry, now);
  const iv = impliedVol({ type: o.type, spot: m.spot, strike: o.strike, t, premium }) ?? 0.15;
  if (iv > MAX_IV) return { skipped: `premium is expensive (implied volatility ${Math.round(iv * 100)}%, limit ${MAX_IV * 100}%)` };
  const later = Math.max(t - WAIT_MS / MS_YEAR, (5 * 60000) / MS_YEAR);

  // The premium the contract is worth when the index is at the chart's stop level.
  const rawStop = bsPrice({ type: o.type, spot: read.stop.price, strike: o.strike, t: later, iv });
  const lossPct = (premium - rawStop) / premium;
  if (lossPct > MAX_LOSS_PCT) return { skipped: `the chart stop (Nifty ${round2(read.stop.price)}) would cost ${Math.round(lossPct * 100)}% of the premium, over the ${MAX_LOSS_PCT * 100}% limit` };
  const chartLoss = Math.max(premium - rawStop, MIN_SIZING_LOSS_PCT * premium);

  const lotSize = contract.lotSize;
  const limit = rules.stopLoss; // 0 = no limit
  // the loss at the chart stop plus the round-trip charges must fit the limit, so the hard stop (at the limit) stays behind the chart stop
  const costOf = (n) => n * lotSize * chartLoss + roundTripCharges({ qty: n * lotSize, price: premium, segment: 'OPT' });
  let byRisk = limit > 0 ? Math.floor(limit / (lotSize * chartLoss)) : Infinity;
  while (limit > 0 && byRisk > 0 && costOf(byRisk) > limit) byRisk -= 1;
  const byBudget = Math.floor(Math.min(settings.budget - spentBudget, available) / (lotSize * premium * 1.02));
  const lots = Math.min(wantLots ?? settings.maxLots, settings.maxLots, byRisk, byBudget);
  if (lots < 1) {
    return {
      skipped: byRisk < 1
        ? `one lot would lose ₹${round2(lotSize * chartLoss)} at the chart stop, over your ₹${limit} limit for one trade`
        : `one lot costs ₹${round2(lotSize * premium)}, more than the ₹${round2(Math.min(settings.budget - spentBudget, available))} left to spend`,
    };
  }
  const qty = lots * lotSize;
  const charges = roundTripCharges({ qty, price: premium, segment: 'OPT' });
  // the hard stop: where the premium has lost the limit less the charges, so a stop-out costs about the limit after charges (plus any slippage on a fast fall)
  const stopLoss = limit > 0 ? Math.max(round2(Math.ceil((premium - Math.max(HARD_STOP_MULT * limit - charges, limit * 0.5) / qty) * 20 - 1e-9) / 20), 0.05) : null; // rounded up to the 0.05 tick, so it never loses more

  return {
    plan: {
      symbol: contract.symbol,
      type: o.type,
      strike: o.strike,
      expiry: o.expiry,
      lotSize,
      lots,
      qty,
      premium,
      iv: round2(iv * 100),
      spot: m.spot,
      stopSpot: read.stop.price,
      stopNote: read.stop.note,
      stopLoss,
      lossPct: round2(lossPct * 100),
      maxLoss: round2(qty * chartLoss),
      worstCase: stopLoss == null ? null : round2(qty * (premium - stopLoss)),
      lockStart: rules.lockStart,
      lockGap: rules.lockGap,
      lockSteps: rules.steps ?? [],
      charges,
    },
  };
}

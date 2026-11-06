import { round2 } from '../utils/money.js';
import { roundTripCharges } from './charges.js';

/** Per-unit stop distance that leaves estimated round-trip charges inside `perTradeRupees`. 0 when charges alone exceed it. */
export function fittedStopDistance({ perTradeRupees, qty, price, segment }) {
  if (!(perTradeRupees > 0) || !(qty >= 1)) return null;
  const room = perTradeRupees - roundTripCharges({ qty, price, segment });
  if (room <= 0) return 0;
  return room / qty;
}

/**
 * Opening check for manual and auto paper orders. Uses the caller's existing limits.
 * Auto size may be reduced so stop distance plus estimated round-trip charges fit the rupee stop.
 * Manual size is never changed: the order is rejected instead.
 * `stopDistance` is rupees per share (or per option unit) to the stop. A later fresh print can still gap through it.
 */
export function openingDecision({
  qty,
  price,
  stopDistance,
  perTradeRupees,
  segment = 'EQ',
  openCount = 0,
  maxOpen = 0,
  openRiskRupees = 0,
  dayRealised = 0,
  unrealisedLoss = 0,
  dailyLossPct = 0,
  balance = 0,
  source = 'MANUAL',
}) {
  const chargesFor = (q) => roundTripCharges({ qty: q, price, segment });
  const riskFor = (q) => round2((stopDistance > 0 ? stopDistance * q : 0) + chargesFor(q));
  const dailyCap = round2((balance * dailyLossPct) / 100);
  const dayLoss = round2(Math.max(0, -(dayRealised || 0)) + Math.max(0, unrealisedLoss || 0));
  const bookCap = perTradeRupees > 0 && maxOpen > 0 ? round2(perTradeRupees * maxOpen) : Infinity;
  const reject = (code, message, useQty, tradeRisk) => ({ ok: false, code, message, qty: useQty, tradeRisk, dayLoss, dailyCap, bookCap, reducedFrom: null });

  let useQty = qty;
  let reducedFrom = null;
  if (!(useQty >= 1) || !(price > 0)) return reject('INVALID_QTY', 'Quantity and price must be positive.', useQty, 0);

  const overTrade = () => perTradeRupees > 0 && riskFor(useQty) > perTradeRupees + 0.009;
  if (overTrade()) {
    if (source !== 'AUTO' || !(stopDistance > 0)) {
      return reject('RISK_PER_TRADE', `This order risks about ₹${riskFor(qty)} including estimated charges, over the ₹${perTradeRupees} stop configured for this book.`, qty, riskFor(qty));
    }
    let next = useQty;
    while (next > 0 && riskFor(next) > perTradeRupees + 0.009) next -= 1;
    if (next < 1) {
      return reject('RISK_PER_TRADE', `Even one unit risks about ₹${riskFor(1)} including charges, over the ₹${perTradeRupees} stop.`, 0, riskFor(1));
    }
    reducedFrom = useQty;
    useQty = next;
  }

  const tradeRisk = riskFor(useQty);
  if (maxOpen > 0 && openCount >= maxOpen) {
    return reject('MAX_OPEN', `Already ${openCount} open position${openCount === 1 ? '' : 's'}. The configured maximum is ${maxOpen}.`, useQty, tradeRisk);
  }
  if (openRiskRupees + tradeRisk > bookCap + 0.05) {
    return reject('BOOK_RISK', `Open stop-risk plus this order is about ₹${round2(openRiskRupees + tradeRisk)}, over ₹${bookCap} (${maxOpen} × ₹${perTradeRupees}).`, useQty, tradeRisk);
  }
  if (dailyCap > 0 && dayLoss + tradeRisk > dailyCap + 0.05) {
    return reject('DAILY_LOSS', `Today's realised and open losses plus this order's planned risk are about ₹${round2(dayLoss + tradeRisk)}, over the ${dailyLossPct}% daily limit (₹${dailyCap}).`, useQty, tradeRisk);
  }
  return { ok: true, qty: useQty, tradeRisk, dayLoss, dailyCap, bookCap, reducedFrom };
}

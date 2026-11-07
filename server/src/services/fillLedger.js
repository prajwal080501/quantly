import { CashPosting } from '../models/CashPosting.js';
import { FillLedger } from '../models/FillLedger.js';
import { Order, Position, Trade, Wallet } from '../models/index.js';
import { round2 } from '../utils/money.js';

/**
 * Standalone Mongo cannot run multi-document transactions (the deployed URI has no replicaSet).
 * The atomic commit is one unique CashPosting insert. Wallet.balance is then set to
 * starting capital plus the sum of postings, so a retry cannot add the same fill twice.
 * Position, order, and trade writes store absolute values and are safe to repeat.
 */

async function walletFor(userId, startingBalance) {
  return Wallet.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { balance: startingBalance, startingBalance } },
    { upsert: true, returnDocument: 'after' },
  );
}

// One caller wins the claim. The pre-image balance is the cash figure to preserve.
// A fill posting is not inserted until this returns, so it cannot erase that figure.
async function adoptHistoricalCash(wallet) {
  const key = `opening:${wallet.user}`;
  if (await CashPosting.exists({ key })) return;
  const claimed = await Wallet.findOneAndUpdate(
    { _id: wallet._id, ledgerAdopted: { $ne: true } },
    { $set: { ledgerAdopted: true } },
    { returnDocument: 'before' },
  );
  const source = claimed || await Wallet.findById(wallet._id);
  if (!source) return;
  if (!claimed && await CashPosting.exists({ user: source.user, key: { $ne: key } })) return;
  const gap = round2(source.balance - source.startingBalance);
  if (gap === 0) return;
  try {
    await CashPosting.create({ key, user: source.user, delta: gap });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

export async function repairBalance(userId, startingBalance) {
  const wallet = await walletFor(userId, startingBalance);
  await adoptHistoricalCash(wallet);
  const [sum] = await CashPosting.aggregate([
    { $match: { user: wallet.user } },
    { $group: { _id: null, total: { $sum: '$delta' } } },
  ]);
  const balance = round2(wallet.startingBalance + (sum?.total || 0));
  if (wallet.balance !== balance) {
    wallet.balance = balance;
    await wallet.save();
  }
  return wallet;
}

export async function postCash(userId, key, delta, startingBalance) {
  const wallet = await walletFor(userId, startingBalance);
  await adoptHistoricalCash(wallet);
  try {
    await CashPosting.create({ key, user: userId, delta: round2(delta) });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  return repairBalance(userId, startingBalance);
}

async function applyPlan(plan, startingBalance) {
  if (plan.walletDelta != null) await postCash(plan.userId, plan.key, plan.walletDelta, startingBalance);
  for (const row of plan.positions || []) {
    await Position.updateOne(row.match, { $set: row.set }, { upsert: true });
  }
  if (plan.trades?.length) {
    for (const trade of plan.trades) {
      try {
        await Trade.create(trade);
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
  }
  if (plan.order) {
    await Order.updateOne({ _id: plan.order.id }, { $set: plan.order.set }, { upsert: true });
  }
  for (const leg of plan.legs || []) {
    await Order.updateOne({ fillKey: leg.fillKey }, { $setOnInsert: leg }, { upsert: true });
  }
  for (const cancel of plan.cancels || []) {
    await Order.updateOne({ _id: cancel.id, status: 'OPEN' }, { $set: { status: 'CANCELLED', cancelledAt: cancel.at, rejectReason: cancel.reason, blockedMargin: 0 } });
  }
}

/** Re-apply every fill whose plan was saved but not marked finished. Safe to run on every startup. */
export async function reconcilePending(startingBalance) {
  const rows = await FillLedger.find({ applied: { $ne: true } });
  for (const row of rows) await commitFill(row.plan, startingBalance);
  return rows.length;
}

/** Freeze `plan` on first use, then apply it. A second call with the same key does not post cash again. */
export async function commitFill(plan, startingBalance) {
  let ledger = await FillLedger.findOne({ key: plan.key });
  if (!ledger) {
    try {
      ledger = await FillLedger.create({ key: plan.key, user: plan.userId, plan, applied: false });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      ledger = await FillLedger.findOne({ key: plan.key });
    }
  }
  const frozen = ledger.plan;
  await applyPlan(frozen, startingBalance);
  if (!ledger.applied) await FillLedger.updateOne({ _id: ledger._id }, { $set: { applied: true } });
  return frozen;
}

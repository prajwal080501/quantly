import mongoose from 'mongoose';

// One immutable cash movement. The insert is the atomic commit on standalone Mongo.
// Wallet.balance is repaired from the sum of these rows plus starting capital.
const cashPostingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    delta: { type: Number, required: true },
  },
  { timestamps: true },
);

export const CashPosting = mongoose.model('CashPosting', cashPostingSchema);

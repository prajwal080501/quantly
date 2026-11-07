import mongoose from 'mongoose';

// Frozen plan for one paper fill. Re-applying it writes the same absolute position, order, and trades.
const fillLedgerSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: mongoose.Schema.Types.Mixed, required: true },
    applied: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const FillLedger = mongoose.model('FillLedger', fillLedgerSchema);

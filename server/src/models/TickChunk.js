import mongoose from 'mongoose';

// A few minutes of one-second samples of one symbol (Nifty or an option contract), packed (see ticks/tickRecorder.js). Market data, shared by every user.
const tickChunkSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    day: { type: String, required: true }, // YYYY-MM-DD, IST
    from: { type: Number, required: true }, // first second in the chunk (epoch seconds)
    to: { type: Number, required: true }, // last second in the chunk
    count: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);
tickChunkSchema.index({ symbol: 1, day: 1, from: 1 }, { unique: true });
tickChunkSchema.index({ day: 1 });

export const TickChunk = mongoose.model('TickChunk', tickChunkSchema);

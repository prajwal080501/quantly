import { gunzipSync, gzipSync } from 'node:zlib';
import { TickChunk } from '../models/TickChunk.js';
import { isOptionSymbol } from '../options/symbols.js';
import { getMarketStatus, istParts } from '../market/marketHours.js';
import { logger } from '../utils/logger.js';

// One-second record of the Nifty index and the option contracts that stream, for the last RETAIN_DAYS trading days.
// Every second the newest tick of each symbol is kept as a row; the rows are packed and saved every few minutes, and
// days beyond RETAIN_DAYS are deleted (at start and after every save). Never recorded from the mock feed: those prices are made up.

export const RETAIN_DAYS = 3;
export const SAMPLE_MS = 1000;
export const FLUSH_MS = 5 * 60000;
export const LEVELS = 5;
export const COLS = 5 + LEVELS * 4; // time, price, volume, total buy qty, total sell qty, then bid price/qty and ask price/qty per level
const INDEX_SYMBOL = 'NIFTY 50';
const cap = (v) => Math.min(Math.max(Math.round(v || 0), 0), 2147483647);

/** Is this symbol worth a second-by-second record? */
export const isRecorded = (symbol) => symbol === INDEX_SYMBOL || isOptionSymbol(symbol);

/** A tick -> one row of numbers (prices in paise); the order book is padded to five levels. */
export function tickRow(tick, sec) {
  const row = [sec, Math.round((tick.ltp || 0) * 100), cap(tick.volume), cap(tick.totalBuyQty), cap(tick.totalSellQty)];
  for (const side of ['bids', 'asks']) {
    for (let i = 0; i < LEVELS; i++) {
      const lvl = tick.depth?.[side]?.[i];
      row.push(Math.round((lvl?.price || 0) * 100), cap(lvl?.qty));
    }
  }
  return row;
}

/** Rows -> Buffer: each column as the change from the row before, gzipped. */
export function packRows(rows) {
  const n = rows.length;
  const cols = new Int32Array(n * COLS);
  const prev = new Array(COLS).fill(0);
  rows.forEach((row, i) => {
    for (let k = 0; k < COLS; k++) {
      cols[k * n + i] = row[k] - prev[k];
      prev[k] = row[k];
    }
  });
  return gzipSync(Buffer.from(cols.buffer));
}

/** Buffer -> readable samples, oldest first. */
export function unpackRows(buf, count) {
  const raw = gunzipSync(buf);
  const cols = new Int32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const sum = new Array(COLS).fill(0);
  const out = [];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < COLS; k++) sum[k] += cols[k * count + i];
    const level = (base) => Array.from({ length: LEVELS }, (_, j) => ({ price: sum[base + j * 2] / 100, qty: sum[base + j * 2 + 1] })).filter((l) => l.price > 0);
    out.push({ time: sum[0], ltp: sum[1] / 100, volume: sum[2], totalBuyQty: sum[3], totalSellQty: sum[4], bids: level(5), asks: level(5 + LEVELS * 2) });
  }
  return out;
}

/** Saved chunks: add, read back, keep the newest `retainDays` days. */
export class TickStore {
  constructor({ retainDays = RETAIN_DAYS } = {}) {
    this.retainDays = retainDays;
  }

  async saveChunk(symbol, day, rows) {
    if (!rows.length) return;
    await TickChunk.updateOne(
      { symbol, day, from: rows[0][0] },
      { $set: { to: rows.at(-1)[0], count: rows.length, data: packRows(rows) } },
      { upsert: true },
    );
  }

  /** Samples of one symbol on one day between two epoch seconds. */
  async read(symbol, day, from = 0, to = Infinity) {
    const chunks = await TickChunk.find({ symbol, day, to: { $gte: from }, from: { $lte: to } }).sort({ from: 1 }).lean();
    return chunks.flatMap((c) => unpackRows(c.data.buffer ? Buffer.from(c.data.buffer, c.data.byteOffset, c.data.length) : c.data, c.count)).filter((r) => r.time >= from && r.time <= to);
  }

  /** Deletes the days beyond the newest `retainDays`. Returns how many days were removed. */
  async prune() {
    const days = (await TickChunk.distinct('day')).sort().reverse();
    if (days.length <= this.retainDays) return 0;
    const oldest = days[this.retainDays - 1];
    await TickChunk.deleteMany({ day: { $lt: oldest } });
    return days.length - this.retainDays;
  }

  async summary() {
    const [days, size, symbols] = await Promise.all([
      TickChunk.distinct('day'),
      TickChunk.aggregate([{ $group: { _id: null, bytes: { $sum: { $binarySize: '$data' } }, rows: { $sum: '$count' } } }]),
      TickChunk.distinct('symbol'),
    ]);
    const sorted = days.sort();
    return { days: sorted.length, list: sorted, from: sorted[0] ?? null, to: sorted.at(-1) ?? null, symbols: symbols.length, rows: size[0]?.rows ?? 0, bytes: size[0]?.bytes ?? 0, keeps: this.retainDays };
  }
}

export class TickRecorder {
  constructor({ market, config = {}, store = new TickStore(), now = () => new Date(), sampleMs = SAMPLE_MS, flushMs = FLUSH_MS }) {
    this.market = market;
    this.holidays = config.nseHolidays || [];
    this.enabled = config.tickRecord !== false;
    this.store = store;
    this.now = now;
    this.sampleMs = sampleMs;
    this.flushMs = flushMs;
    this.latest = new Map(); // symbol -> newest tick
    this.sampled = new Map(); // symbol -> the tick already written, so a quiet second adds no row
    this.buffers = new Map(); // symbol -> { day, rows }
    this.timers = [];
    this.onTick = (tick) => {
      if (isRecorded(tick.symbol)) this.latest.set(tick.symbol, tick);
    };
  }

  get simulated() {
    return Boolean(this.market.provider.isSimulated);
  }

  start() {
    if (!this.enabled || this.simulated) return;
    this.market.on('tick', this.onTick);
    this.store.prune().catch((err) => logger.warn(`Tick record cleanup failed: ${err.message}`));
    this.timers.push(setInterval(() => this.sample(), this.sampleMs), setInterval(() => this.flush(), this.flushMs));
    this.timers.forEach((t) => t.unref?.());
  }

  stop() {
    this.market.off('tick', this.onTick);
    this.timers.forEach(clearInterval);
    this.timers = [];
    return this.flush();
  }

  /** Writes one row for each symbol that ticked since the last second, while the market is open. */
  sample() {
    const date = this.now();
    if (!getMarketStatus(date, this.holidays).isOpen) return 0;
    const sec = Math.floor(date.getTime() / 1000);
    const day = istParts(date).dateKey;
    let added = 0;
    for (const [symbol, tick] of this.latest) {
      if (this.sampled.get(symbol) === tick) continue;
      this.sampled.set(symbol, tick);
      let buf = this.buffers.get(symbol);
      if (!buf || buf.day !== day) {
        if (buf?.rows.length) this.#save(symbol, buf);
        buf = { day, rows: [] };
        this.buffers.set(symbol, buf);
      }
      buf.rows.push(tickRow(tick, sec));
      added++;
    }
    return added;
  }

  /** Saves what is held in memory, then deletes the days beyond the newest three. */
  async flush() {
    const jobs = [];
    for (const [symbol, buf] of this.buffers) {
      if (!buf.rows.length) continue;
      const rows = buf.rows;
      buf.rows = [];
      jobs.push(this.#save(symbol, { day: buf.day, rows }));
    }
    await Promise.all(jobs);
    if (jobs.length) await this.store.prune().catch((err) => logger.warn(`Tick record cleanup failed: ${err.message}`));
  }

  async #save(symbol, { day, rows }) {
    try {
      await this.store.saveChunk(symbol, day, rows);
    } catch (err) {
      logger.warn(`Could not save ${symbol} seconds: ${err.message}`);
    }
  }

  status() {
    const rowsHeld = [...this.buffers.values()].reduce((a, b) => a + b.rows.length, 0);
    return { recording: this.enabled && !this.simulated && this.timers.length > 0, simulated: this.simulated, symbols: [...this.latest.keys()], rowsHeld };
  }
}

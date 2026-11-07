import { EventEmitter } from 'node:events';
import { ALL_SYMBOLS, INDICES, NIFTY50 } from './instruments.js';
import { getMarketStatus } from './marketHours.js';
import { INTERVAL_SECONDS, aggregateCandles } from './providers/BaseProvider.js';
import { istParts } from './marketHours.js';
import { assessQuote, feedAuth, DEFAULT_MAX_AGE_MS } from './quoteFreshness.js';
import { addDays, daysBetween } from './days.js';
import { INDEXES, atmStrike, chooseExpiry, weeklyExpiries, parseOptionSymbol, isIndexKey } from '../options/symbols.js';

const HISTORY_TTL_MS = 30000;

/**
 * Single owner of the provider connection. Keeps the latest tick per symbol and
 * re-emits ticks for the order engine and the Socket.IO relay.
 */
const DAILY_TTL_MS = 6 * 60 * 60 * 1000;
const DAILY_DAYS = 45;

export class MarketDataService extends EventEmitter {
  constructor(provider, { holidays = [], expiryWeekday, enforceHours = false } = {}) {
    super();
    this.setMaxListeners(50);
    this.provider = provider;
    this.holidays = holidays;
    this.expiryWeekday = expiryWeekday; // Nifty's weekly expiry weekday
    this.enforceHours = enforceHours; // tells the app whether the order engine refuses orders outside market hours
    this.history = null; // the saved candle history (HistoryStore), set by HistorySync; studies and Review read it first
    this.latest = new Map();
    this.lastStamp = new Map();
    this.rejections = new Map();
    this.historyCache = new Map();
    this.feedStatus = { connected: false, message: 'Not started' };
    this.contracts = new Map(); // option symbol -> { symbol, strike, type, expiry, lotSize } for every contract picked so far

    provider.on('tick', (tick) => {
      const verdict = assessQuote(tick, { allowMock: Boolean(this.provider.isSimulated), lastAcceptedTs: this.lastStamp.get(tick.symbol) });
      const stored = { ...tick, freshness: verdict };
      this.latest.set(tick.symbol, stored);
      if (!verdict.ok) {
        this.rejections.set(tick.symbol, verdict);
        this.emit('quote-rejected', { symbol: tick.symbol, freshness: verdict });
        return;
      }
      this.lastStamp.set(tick.symbol, verdict.ts);
      this.rejections.delete(tick.symbol);
      this.emit('tick', stored);
    });
    provider.on('status', (status) => {
      this.feedStatus = status;
      this.emit('status', this.status());
    });
  }

  async start() {
    await this.provider.connect();
    await this.provider.subscribe(ALL_SYMBOLS);
  }

  async stop() {
    await this.provider.disconnect();
  }

  getTick(symbol) {
    return this.latest.get(symbol) || null;
  }

  getLtp(symbol) {
    return this.latest.get(symbol)?.ltp ?? null;
  }

  /** A quote that is fresh at this instant. A stored tick whose upstream time has aged out is not returned. */
  getExecutableQuote(symbol) {
    const tick = this.latest.get(symbol);
    if (!tick) return null;
    const verdict = assessQuote(tick, { allowMock: Boolean(this.provider.isSimulated) });
    return verdict.ok ? { ...tick, freshness: verdict } : null;
  }

  /**
   * Ask the configured provider for a new quote. Never substitutes the last cached price or the mock feed.
   * Returns null when the provider is down, unauthenticated, or the upstream timestamp is not fresh.
   */
  async fetchFreshQuote(symbol) {
    if (typeof this.provider.fetchQuote !== 'function') return null;
    let tick;
    try {
      tick = await this.provider.fetchQuote(symbol);
    } catch (err) {
      const freshness = { ok: false, code: 'FEED_ERROR', message: err.message || 'Quote request failed.' };
      this.rejections.set(symbol, freshness);
      this.emit('quote-rejected', { symbol, freshness });
      return null;
    }
    if (!tick) return null;
    const verdict = assessQuote(tick, { allowMock: Boolean(this.provider.isSimulated), lastAcceptedTs: this.lastStamp.get(symbol) });
    const stored = { ...tick, freshness: verdict };
    this.latest.set(symbol, stored);
    if (!verdict.ok) {
      this.rejections.set(symbol, verdict);
      this.emit('quote-rejected', { symbol, freshness: verdict });
      return null;
    }
    this.lastStamp.set(symbol, verdict.ts);
    this.rejections.delete(symbol);
    this.emit('tick', stored);
    return stored;
  }

  quoteProblem(symbol) {
    const tick = this.latest.get(symbol);
    if (!tick) return this.rejections.get(symbol) || { ok: false, code: 'NO_PRICE', message: 'No price from the feed.' };
    const verdict = assessQuote(tick, { allowMock: Boolean(this.provider.isSimulated) });
    return verdict.ok ? null : verdict;
  }

  snapshot() {
    return {
      stocks: NIFTY50.map((s) => ({ ...s, seed: undefined, tick: this.latest.get(s.symbol) || null })),
      indices: INDICES.map((s) => ({ symbol: s.symbol, name: s.name, tick: this.latest.get(s.symbol) || null })),
    };
  }

  status(now = new Date()) {
    return {
      market: {
        ...getMarketStatus(now, this.holidays),
        enforced: this.enforceHours,
        holidayCalendar: this.holidays.length ? 'configured' : 'unconfigured',
        holidayWarning: this.holidays.length
          ? null
          : 'NSE_HOLIDAYS is empty. Weekends are closed. A weekday exchange holiday is not detected until those dates are set from the NSE holiday circular.',
      },
      feed: {
        provider: this.provider.name,
        simulated: this.provider.isSimulated,
        connected: this.feedStatus.connected,
        message: this.feedStatus.message,
        auth: feedAuth(this.feedStatus.message, this.feedStatus.connected),
        capabilities: this.provider.capabilities,
      },
      quotes: { policy: 'fresh-upstream-timestamp', maxAgeMs: DEFAULT_MAX_AGE_MS },
    };
  }

  /** Lot size of an option contract this service has picked, or undefined for anything else. */
  lotSize(symbol) {
    return this.contracts.get(symbol)?.lotSize;
  }

  /** The weekly expiry weekday of an index's options (0 = Sunday). */
  weekdayOf(index) {
    return this.expiryWeekday ?? INDEXES[index]?.expiryWeekday;
  }

  /**
   * The at-the-money contract of `type` ('CE' or 'PE') on `index` ('NIFTY') for the expiry worth buying, started streaming so it has a price.
   * Returns null when the feed lists no contracts or the index has no price yet.
   */
  async pickOption({ type, now = new Date(), minDays = 1, index = 'NIFTY' }) {
    const idx = INDEXES[index] ?? INDEXES.NIFTY;
    const spot = this.getExecutableQuote(idx.symbol)?.ltp;
    if (!spot) return null;
    const listed = await this.provider.getOptionExpiries(idx.key);
    const expiries = listed.length ? listed : weeklyExpiries(now, { holidays: this.holidays, weekday: this.weekdayOf(idx.key) });
    const expiry = chooseExpiry(expiries, now, { minDays });
    if (!expiry) return null;
    const atm = atmStrike(spot, idx.strikeStep);
    const pick = (await this.provider.getOptionContracts(expiry, idx.key))
      .filter((c) => c.type === type)
      .sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm))[0];
    if (!pick) return null;
    this.contracts.set(pick.symbol, pick);
    await this.provider.subscribe([pick.symbol]);
    return { ...pick, ltp: await this.#priceOf(pick.symbol), spot };
  }

  /** The price of a symbol just subscribed to: its first tick comes a moment after the subscription, so wait for it (up to `ms`) instead of reading nothing. */
  async #priceOf(symbol, ms = 1500) {
    const end = Date.now() + ms;
    let quote = this.getExecutableQuote(symbol);
    while (!quote && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      quote = this.getExecutableQuote(symbol);
    }
    return quote?.ltp ?? null;
  }

  /** Start streaming a contract (e.g. one that is already held after a restart). */
  async watchOption(symbol, contract = null) {
    const o = parseOptionSymbol(symbol);
    if (o && !isIndexKey(o.index)) return; // an old Sensex contract: the feed no longer carries it
    if (contract) this.contracts.set(symbol, contract);
    await this.provider.subscribe([symbol]);
  }

  /** About `days` days of daily candles, cached for hours: the last month does not change while trading. */
  async getDaily(symbol, days = DAILY_DAYS) {
    const key = `${symbol}|1d`;
    const hit = this.historyCache.get(key);
    if (hit && Date.now() - hit.at < DAILY_TTL_MS) return hit.candles;
    const candles = await this.provider.getDailyHistory(symbol, days);
    if (candles.length) this.historyCache.set(key, { at: Date.now(), candles });
    return candles;
  }

  /** `days` calendar days of `unit`-minute candles for the study, cached for half an hour. */
  async getRange(symbol, unit, days) {
    const key = `${symbol}|r${unit}|${days}`;
    const hit = this.historyCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60000) return hit.candles;
    const candles = await this.provider.getRangeHistory(symbol, unit, days);
    this.historyCache.set(key, { at: Date.now(), candles });
    return candles;
  }

  /**
   * `days` calendar days of `unit`-minute candles for a study. From the saved history when the symbol has some (plus whatever came after it,
   * today included, from the broker); otherwise straight from the broker as `getRange`.
   */
  async getStudyRange(symbol, unit, days) {
    const cov = this.history ? await this.history.coverage(symbol).catch(() => null) : null;
    if (!cov) return this.getRange(symbol, unit, days);
    const today = istParts(new Date()).dateKey;
    // a day saved only up to some time of an earlier date is read again from the broker, whole
    const upTo = cov.partial && cov.partial < today ? addDays(cov.partial, -1) : cov.to;
    const stored = await this.history.read(symbol, addDays(today, -days), upTo);
    const since = daysBetween(upTo, today);
    const tail = since >= 1 ? (await this.getRange(symbol, 1, since + 1)).filter((c) => istParts(new Date(c.time * 1000)).dateKey > upTo) : [];
    // today saved only up to the last update: the minutes since then come from the broker (kept for a minute and a half, so a study of 50 stocks asks once each)
    const fresh = since === 0 && cov.partial === today ? await this.#todayTail(symbol) : [];
    const merged = [...new Map([...stored, ...tail, ...fresh].map((c) => [c.time, c])).values()].sort((a, b) => a.time - b.time);
    return unit === 1 ? merged : aggregateCandles(merged.map((c) => ({ ...c })), `${unit}m`);
  }

  async #todayTail(symbol) {
    const key = `${symbol}|today`;
    const hit = this.historyCache.get(key);
    if (hit && Date.now() - hit.at < 90_000) return hit.candles;
    try {
      const today = istParts(new Date()).dateKey;
      const candles = (await this.provider.getTodayCandles(symbol, 1)).filter((c) => istParts(new Date(c.time * 1000)).dateKey === today);
      this.historyCache.set(key, { at: Date.now(), candles });
      return candles;
    } catch {
      return []; // what is saved is still used
    }
  }

  /** The 1-minute candles around `day` for Review: the broker's last sessions plus the saved days before and after it, so an older day has its chart. */
  async getMinutes(symbol, day) {
    const live = await this.getCandles(symbol, '1m').catch(() => []);
    if (!this.history) return live;
    const stored = await this.history.read(symbol, addDays(day, -9), addDays(day, 1)).catch(() => []);
    if (!stored.length) return live;
    return [...new Map([...stored, ...live].map((c) => [c.time, c])).values()].sort((a, b) => a.time - b.time);
  }

  async getCandles(symbol, interval) {
    if (!INTERVAL_SECONDS[interval]) throw new Error(`Unsupported interval ${interval}`);
    // The mock feed builds history in memory, so it is always fresh; broker APIs are rate limited.
    if (this.provider.isSimulated) return this.provider.getHistory(symbol, interval);
    const key = `${symbol}|${interval}`;
    const hit = this.historyCache.get(key);
    if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.candles;
    const candles = await this.provider.getHistory(symbol, interval);
    this.historyCache.set(key, { at: Date.now(), candles });
    return candles;
  }
}

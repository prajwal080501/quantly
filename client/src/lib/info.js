import { api } from './api.js';

// The "i" button on every indicator, pattern and combination: what it measures, when it turns true, how a put reads it, what it is good
// with and when it lets you down. The one-line rule comes from the server's catalog (the same text the bot uses); the rest is per group.

const GROUP = {
  Trend: {
    how: 'Trend checks compare price with moving averages or with its own recent highs and lows. They answer "which way is the market leaning right now?"',
    good: 'Good as the base of a combination: buy calls only when the trend is up and puts only when it is down.',
    watch: 'They are slow. In a choppy, sideways day they flip back and forth and give late entries. They say nothing about timing, so pair one with a trigger (a breakout, a cross or a pattern).',
  },
  Momentum: {
    how: 'Momentum checks (RSI, MACD, Stochastic, rate of change and similar) measure how fast price has moved lately compared with before.',
    good: 'Good to confirm a breakout has push behind it, or to wait for a pullback to end.',
    watch: 'Strong momentum can also mean the move is already late. Several momentum checks together mostly say the same thing twice, so they add little to each other.',
  },
  Volatility: {
    how: 'Volatility checks (ATR, Bollinger and Keltner bands, squeezes) measure how big the bars are, and whether price is stretched outside its usual band.',
    good: 'Good to find quiet coils before a burst (a squeeze) or a real expansion (a close outside the band).',
    watch: 'A close outside a band can be the start of a run or the top of a spike. They do not pick a direction on their own.',
  },
  'Volume and VWAP': {
    how: 'The index has no volume of its own, so these are built from the traded value of the 50 stocks: VWAP (the volume-weighted average price), volume spikes and money flow.',
    good: 'Good to tell a breakout with real participation from a thin one.',
    watch: 'They need the 50 stocks’ candles; on a day those are missing the check cannot be used.',
  },
  Candles: {
    how: 'Candle checks look at the shape of the last bar or two: a strong close, an engulfing body, a long wick.',
    good: 'Good as the last trigger, after a trend or a level says where to look.',
    watch: 'One candle is a small sample. On its own it fires very often, in the middle of nowhere.',
  },
  Market: {
    how: 'Market checks look at the 50 stocks together (breadth: how many are up), or at the bigger picture (yesterday, the gap, the day’s range).',
    good: 'Good to stay on the side the whole market is on.',
    watch: 'Breadth needs the 50 stocks’ candles. It changes slowly, so it is a filter, not a trigger.',
  },
  'Time of day': {
    how: 'Time checks limit when a combination may fire, such as only after 09:45 or only before 14:30.',
    good: 'Good to avoid the noisy first minutes and the slow afternoon.',
    watch: 'A time window that looks best on a few weeks is often luck. Keep windows wide and simple.',
  },
  'Chart patterns': {
    how: 'Chart patterns are complete setups (a breakout of the last hour, an opening range break, a double bottom...) that also say where the stop goes.',
    good: 'Good as the trigger of a combination: they fire at a clear moment and bring their own stop.',
    watch: 'Each pattern fails often on its own. Open it in the Combination Lab to see its own record, and add one trend check so it trades only with the market.',
  },
  News: {
    how: 'News checks read the tagged headlines for the stock.',
    good: 'Good for shares around results and announcements.',
    watch: 'The index options trader cannot use stock news.',
  },
};

const KIND = {
  state: 'A state: it is true on every bar while the condition holds (for example "RSI above 50"). In a combination it must be true on the entry bar.',
  event: 'An event: it is true on the bar where something just happened (a cross, a break, a pattern). In a combination it counts for the next few bars (the window, 3 by default), so it can line up with the other checks.',
};

let catalogPromise = null;
/** The server's list of checks, fetched once per page load. */
export function loadCatalog() {
  if (!catalogPromise) catalogPromise = api('/combos/catalog').catch((e) => { catalogPromise = null; throw e; });
  return catalogPromise;
}

/** Finds a check by its key ('aboveVwap'), its pattern key ('breakout'), a 'check:' key, or its label. */
export function findCondition(conditions, ref) {
  if (!ref || !conditions) return null;
  const key = String(ref).replace(/^check:/, '');
  return conditions.find((c) => c.key === key) || conditions.find((c) => c.pattern === key) || conditions.find((c) => c.label.toLowerCase() === key.toLowerCase()) || null;
}

/** Everything the info sheet shows for one check. */
export function conditionInfo(cond) {
  if (!cond) return null;
  const g = GROUP[cond.group] || {};
  return {
    title: cond.label,
    group: cond.group,
    rule: cond.text,
    how: g.how || null,
    kind: KIND[cond.kind] || null,
    put: 'For a put the same check is read on the chart turned upside down: "above" becomes "below", "up" becomes "down". So every check has a twin for the other side.',
    good: g.good || null,
    watch: g.watch || null,
    needs: cond.needs === 'flow' ? 'Needs the 50 stocks’ traded value (their candles must be loaded).' : cond.needs === 'breadth' ? 'Needs the 50 stocks’ candles (breadth).' : cond.needs === 'news' ? 'Needs news (shares only).' : null,
  };
}

/** Splits a combination's label like "Breakout + RSI over 50 + EMA 9 above 21" into the checks it is made of. */
export function conditionsInLabel(conditions, label) {
  if (!label || !conditions) return [];
  const parts = String(label).replace(/^(Mine|Combination): /, '').split(/\s\+\s/);
  return parts.map((p) => findCondition(conditions, p.trim())).filter(Boolean);
}

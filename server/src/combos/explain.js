// Plain-words help for every check a combination is built from: what the indicator measures, exactly when the check is true
// (the thresholds come from the check itself), how it works for a put, and how long it counts. Shown by the info buttons.

// What each family of indicators measures, matched on the check key. The first match wins.
const FAMILIES = [
  [/^p_/, null],
  [/^(emaFastOverSlow|ema21Over50|emaStack|aboveEma|ema21Rising|ema50Rising|tf15Trend)/, 'EMA (exponential moving average)', 'The average closing price of the last N five-minute bars, with the newest bars counting most. A short EMA above a long one, or price above an EMA, means prices have been rising. It follows price, so it is late at turns and works best on trending days.'],
  [/^aboveSma/, 'SMA (simple moving average)', 'The plain average close of the last N five-minute bars. Price above it means the recent bars closed higher than the average. Slower than an EMA.'],
  [/^aboveHma/, 'Hull moving average', 'A moving average built to lag less than the others. It turns sooner, so it gives earlier but noisier signals.'],
  [/^supertrend/, 'Supertrend', 'A line drawn a set number of ATRs (average bar sizes) away from price. While price stays above it the line trails up under price; a close through it flips it. The two numbers are the ATR length and the multiplier: (10, 3) is slow and steady, (7, 2) quicker.'],
  [/^psar/, 'Parabolic SAR', 'A trailing dot that follows price and speeds up as the move goes on. Dots under price mean an up move; they jump above price when it reverses.'],
  [/^(adx|diPositive)/, 'ADX and DI (directional movement)', 'ADX measures how strong a trend is (not its direction): under 20 is a weak or sideways market, over 25 a strong trend. +DI and -DI measure up moves against down moves over 14 bars; the bigger one tells who is leading.'],
  [/^aroon/, 'Aroon', 'How recently the highest high and the lowest low of the last 25 bars happened, from 0 to 100. Aroon up near 100 means a new high was just made; Aroon up above Aroon down means the latest high is newer than the latest low.'],
  [/^(cloudAbove|tenkanOverKijun)/, 'Ichimoku', 'A Japanese trend system. The fast line is the middle of the last 9 bars, the slow line the middle of the last 26, and the cloud is built from them. Price above the cloud is read as an up trend.'],
  [/^vortex/, 'Vortex', 'Compares how far each bar reached above the previous low (+VI) with how far it reached below the previous high (-VI) over 14 bars. +VI on top means upward pressure.'],
  [/^linreg/, 'Straight-line trend (linear regression)', 'The best straight line through the last 20 closes. Its slope says up or down; R squared (0 to 1) says how well price fits the line. Over 0.6 is a clean, steady move.'],
  [/^(higherHL|higherLow)/, 'Highs and lows', 'Price structure: in a rise each dip stops higher than the last one, and each push goes further.'],
  [/^(aboveDayOpen|aboveYClose|aboveYHigh|aboveDayMean|nearDayHigh|yHighBreak|gapUp|openDrive)/, "The day's levels", "Where price stands against the day's own reference prices: today's open, yesterday's close and high, today's high. They are levels many traders watch."],
  [/^(aboveOR|orBreakEvent)/, 'Opening range', 'The high and low of the first 15 minutes (09:15 to 09:30). A move out of it after 09:30 often sets the direction of the morning.'],
  [/^trix/, 'TRIX', 'The rate of change of an EMA smoothed three times. Above zero means the smoothed trend is rising. It is slow and filters out small wiggles.'],
  [/^rsi/, 'RSI (relative strength index)', 'Compares the size of up closes with down closes over the last 14 bars (7 for the fast one), from 0 to 100. Over 50 buyers lead, over 70 is stretched (overbought), under 30 oversold.'],
  [/^macd/, 'MACD', 'The 12-bar EMA minus the 26-bar EMA (the MACD line), its 9-bar average (the signal line), and the gap between the two (the histogram). Line over signal, or a growing histogram, means momentum is turning up.'],
  [/^stoch/, 'Stochastic', 'Where the close sits inside the high-low range of the last 14 bars, from 0 (at the low) to 100 (at the high). %K is that value, %D its 3-bar average.'],
  [/^cci/, 'CCI (commodity channel index)', 'How far the typical price is from its 20-bar average, measured in average deviations. Around 0 is normal; over +100 unusually strong; under -100 unusually weak.'],
  [/^willr/, 'Williams %R', 'Like the stochastic, but from 0 (at the 14-bar high) to -100 (at the low). Above -50 means the close is in the upper half of the range.'],
  [/^ao/, 'Awesome oscillator', 'The 5-bar average of bar midpoints minus the 34-bar one. Above zero means recent bars sit higher than the longer run.'],
  [/^ult/, 'Ultimate oscillator', 'Buying pressure over 7, 14 and 28 bars, blended into one number from 0 to 100. Over 50 means buyers lead across all three lengths.'],
  [/^(up10|push6|threeUp)/, 'Price momentum', 'How far and how fast price has moved over the last few bars. ATR is the average size of a five-minute bar, so "1.5 ATR" means one and a half normal bars.'],
  [/^(bb|squeezeFire)/, 'Bollinger bands', 'A 20-bar average with a band two standard deviations above and below it. Most closes stay inside; a close outside is an unusually strong push. Narrow bands mean a quiet market that often comes before a big move.'],
  [/^keltner/, 'Keltner channel', 'A 20-bar EMA with lines 1.5 ATR above and below it. A close over the upper line is a bar that pushed well beyond the usual range.'],
  [/^(atrExpand|roomLeft|nr7Break)/, 'ATR (average true range)', 'The average size of a five-minute bar over the last 14 bars. Rising ATR means the market is moving more; a small day range means the move may not be used up.'],
  [/^(high20|bigBullBar)/, 'Breakouts and big bars', 'A close beyond recent highs, or a bar much bigger than usual, shows buyers pushing through a level where sellers had stopped price before.'],
  [/^(aboveVwap|vwap)/, 'VWAP (volume-weighted average price)', "The average price of the day so far, weighted by how much traded at each price. The index has no volume of its own, so the app builds it from the traded value of the 50 Nifty stocks. Above VWAP, buyers have the upper hand for the day."],
  [/^(volHigh|volSurge|heavyBuy|quietPullback|volDryBreak)/, 'Volume', 'How much traded on the bar against the average of the last 20 bars, built from the traded value of the 50 Nifty stocks. A move on heavy volume has more money behind it.'],
  [/^obv/, 'OBV (on-balance volume)', 'A running total that adds the volume of up bars and takes away the volume of down bars. Rising OBV means more volume on up bars.'],
  [/^cmf/, 'Chaikin money flow', 'Over 20 bars, whether bars close near their highs (buying) or lows (selling), weighted by volume. From -1 to +1; above 0 is buying.'],
  [/^mfi/, 'Money flow index', 'An RSI that also counts volume, from 0 to 100. Over 50 means more money flowed in on up bars than out on down bars.'],
  [/^force/, 'Force index', 'Price change times volume, smoothed. Positive means up moves carry the volume.'],
  [/^(bullBar|closeAbovePrevHigh|strongClose|engulfBull|hammer|soldiers|marubozu|gapAndHold)/, 'Candles', 'The shape of the five-minute candle itself: where it opened and closed and how long its wicks are. A close near the high means buyers won the bar.'],
  [/^breadth/, 'Market breadth', 'How many of the 50 Nifty stocks are above yesterday close right now. When most of them move together, the index move is broad and tends to last; when few agree, it is often a few heavy stocks pulling it.'],
  [/^(morning|midday|afternoon|afterTen|notMidday|firstHour)/, 'Time of day', 'Only the clock (India time). It says nothing about direction; use it beside an entry check to keep or skip certain hours.'],
  [/^trendingNotChoppy/, 'Choppiness index', 'Compares the sum of the bar sizes with the total distance travelled over 14 bars. Under 50 means price is travelling; over 60 means it is going back and forth.'],
  [/^newsAgrees/, 'News', 'Recent headlines about the stock, rated by the app. Live only for shares: past headlines are not kept, so it cannot be studied.'],
];

// Checks that do not pick a side: they are the same for a call and for a put.
const NO_SIDE = new Set(['adxStrong', 'atrExpand', 'bbSqueeze', 'volHigh', 'volSurge', 'trendingNotChoppy', 'roomLeft', 'morning', 'midday', 'afternoon', 'afterTen', 'notMidday', 'firstHour']);

// How traders read each chart pattern, in a line, beside the rule the app uses (the pattern's own text).
const PATTERN_IDEA = {
  doubleBottom: 'Sellers failed twice at the same low, so buyers take over once price clears the bounce between the two lows (the neckline).',
  doubleBottomMid: 'The same idea as the double bottom, with a closer stop so the loss fits the limit.',
  reversal: 'After a hard fall, the first higher low and a close over the previous bar show the selling is spent.',
  breakout: 'Price clears the top of the last hour, where sellers had stopped it, and buyers who were waiting join in.',
  orb: 'The first 15 minutes set a range; the first break out of it often sets the direction of the morning.',
  pullback: 'In a clean up trend, a dip to the 21 EMA is a chance to buy cheaper; the trade starts when price turns back up.',
  engulfing: 'After a fall, one bullish candle swallows the last bearish one: buyers took back everything sellers just did.',
  pinBar: 'Sellers pushed price down but buyers pushed it all the way back up within the bar: a rejection of lower prices.',
  insideBar: 'A big bar, then a pause inside it; the break out of the big bar tells which side won.',
  supertrend: 'The trend line flips from above price to below it: the down move is over by its rule.',
  emaCross: 'The fast average crosses over the slow one: recent prices are now higher than the longer run.',
  breadth: 'Most of the 50 stocks agree on the direction, and the index is on the same side of its day average.',
  orb30: 'The same opening range idea over the first 30 minutes: fewer, slower signals.',
  pdBreak: "Yesterday's high is a level many traders watch; the first close over it today shows buyers in control.",
  momentumBar: 'One big bar closing at its high and over recent highs: a burst of buying.',
  vwapReclaim: 'Price spent a while under the day average, then closes back over it with volume: buyers took back the day.',
  vwapPullback: 'In a day held above a rising VWAP, a dip to VWAP is a chance to buy at the day average.',
  volumeBreakout: 'The last-hour breakout, but only with real money behind it.',
  volumeClimax: 'A heavy-volume bar at the low that closes in its top half: the last sellers are out.',
};

const familyOf = (key) => FAMILIES.find(([re]) => re.test(key));

/**
 * The help for one check: { name, what, idea, when, put, counts, needs, note }. `cond` is a catalog entry ({ key, label, text, kind, needs, pattern }).
 * Every part is plain text; `name` is the indicator family (or the pattern).
 */
export function explainCondition(cond) {
  const f = familyOf(cond.key);
  const pattern = cond.pattern || (cond.key.startsWith('p_') ? cond.key.slice(2) : null);
  const both = NO_SIDE.has(cond.key) || /no direction|either way/i.test(cond.text || '');
  const out = {
    name: pattern ? 'Chart pattern' : f?.[1] || cond.group,
    what: pattern ? null : f?.[2] || null,
    idea: pattern ? PATTERN_IDEA[pattern] || null : null,
    when: `${cond.label}. ${cond.text}`,
    put: both
      ? 'It does not pick a side: it is the same for a call and a put. Pair it with a check that does.'
      : cond.needs === 'breadth'
        ? 'For a put it is the same test turned round: stocks below yesterday close instead of above.'
        : 'For a put it is the same test on the chart turned upside down: above becomes below, highs become lows, rising becomes falling, a cross up becomes a cross down.',
    counts:
      cond.kind === 'event'
        ? 'It is an event: it is true on the closed 5-minute bar where it happens, and a combination still counts it for the next bars of its window (3 bars, 15 minutes, unless the combination sets another).'
        : 'It is a state: it is checked on every closed 5-minute bar and counts for as long as it stays true.',
    needs:
      cond.needs === 'flow'
        ? 'Needs volume: built from the traded value of the 50 Nifty stocks, so it needs their candles saved (Research > Saved data).'
        : cond.needs === 'breadth'
          ? 'Needs the candles of the 50 Nifty stocks (Research > Saved data); without them it cannot be tested.'
          : cond.needs === 'news'
            ? 'Needs live news: shares only, and it cannot be studied on past days.'
            : null,
    note: pattern
      ? 'In a combination the stop is the pattern level above. On its own (as a pattern entry) the bot takes it at the close of the bar it forms on.'
      : 'All checks run on the Nifty (or Sensex) 5-minute chart, on closed bars only, so nothing peeks at the future. The entry is taken at the close of the bar where the whole combination first holds.',
  };
  return out;
}

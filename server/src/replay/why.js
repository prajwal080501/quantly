import { aggregateCandles } from '../market/providers/BaseProvider.js';
import { buildChart, CONDITION_BY_KEY } from '../combos/conditions.js';
import { comboSignals, describeCombo, heldConditions, missingData } from '../combos/combos.js';
import { TECHNIQUES, prepare, findSignals } from '../study/patterns.js';
import { round2 } from '../utils/money.js';

// Why a trade was taken: the pattern or combination that fired, each of its checks at the entry bar, the main indicator readings there,
// and whether the study (the same rules run on the saved candles) sees a signal at that bar. Nothing here looks past the entry bar,
// except the list of the day's study signals, which is made for the whole day so live and study can be compared.

const dayOf = (t) => Math.floor((t + 19800) / 86400);
const num = (x) => x != null && Number.isFinite(x);
const r = (x, d = 2) => (num(x) ? round2(Math.round(x * 10 ** d) / 10 ** d) : null);

/** 5-minute bars from 1-minute candles, without the bucket still forming at `upTo` (seconds). */
export function closedBars5(c1, upTo = null) {
  const bars = aggregateCandles(c1.map((c) => ({ ...c })), '5m');
  const cut = upTo ?? (c1.at(-1)?.time ?? 0) + 60;
  return bars.filter((b) => b.time + 300 <= cut);
}

/** The bar the trade was taken on: the last 5-minute bar that had closed by the entry time. */
export const entryBarIndex = (bars5, entryTime) => {
  let at = -1;
  for (let i = 0; i < bars5.length; i++) if (bars5[i].time + 300 <= entryTime + 30) at = i;
  return at;
};

/** A few indicator readings on bar i of the chart (as plain numbers, the call view: prices as they are). */
export function readingsAt(chart, i) {
  const c = chart.views[1];
  const out = [];
  const add = (label, value, note = null) => value != null && out.push({ label, value, note });
  const close = c.C[i];
  add('Close', r(close));
  const e9 = c.ema(9)[i];
  const e21 = c.ema(21)[i];
  const e50 = c.ema(50)[i];
  add('EMA 9 / 21', num(e9) && num(e21) ? `${r(e9)} / ${r(e21)}` : null, num(e9) && num(e21) ? (e9 > e21 ? 'short trend up' : 'short trend down') : null);
  add('EMA 50', r(e50), num(e50) ? (close > e50 ? 'price above it' : 'price below it') : null);
  const rsi = c.rsi(14)[i];
  add('RSI 14', r(rsi, 1), num(rsi) ? (rsi >= 70 ? 'stretched up' : rsi <= 30 ? 'stretched down' : rsi >= 50 ? 'buyers lead' : 'sellers lead') : null);
  const m = c.macd();
  add('MACD / signal', num(m.line[i]) && num(m.signal[i]) ? `${r(m.line[i])} / ${r(m.signal[i])}` : null, num(m.line[i]) && num(m.signal[i]) ? (m.line[i] > m.signal[i] ? 'above signal' : 'below signal') : null);
  const dmi = c.dmi();
  add('ADX (+DI / -DI)', num(dmi.adx[i]) ? `${r(dmi.adx[i], 1)} (${r(dmi.pdi[i], 1)} / ${r(dmi.ndi[i], 1)})` : null, num(dmi.adx[i]) ? (dmi.adx[i] >= 25 ? 'strong trend' : dmi.adx[i] >= 20 ? 'trend' : 'no clear trend') : null);
  const st = c.st(10, 3).dir[i];
  add('Supertrend 10,3', st === 1 ? 'up' : st === -1 ? 'down' : null);
  const vw = c.vwap()?.[i];
  add('VWAP', r(vw), num(vw) ? (close > vw ? 'price above it' : 'price below it') : null);
  add('ATR (5 min)', r(chart.atr[i]), 'a normal 5-minute range');
  return out;
}

/** The pattern or combination that a trade's setup name refers to. `combos`: the user's combinations, saved now. */
export function sourceOf(setup, { combos = [], detailCombo = null, comboId = null } = {}) {
  const name = String(setup || '');
  if (detailCombo?.conds?.length) return { kind: 'combo', combo: detailCombo, saved: true };
  const m = name.match(/^(?:Combination|Combo):\s*(.+)$/);
  if (m || comboId) {
    const combo = combos.find((c) => (comboId && c.id === comboId) || c.name === m?.[1]) ?? null;
    return { kind: 'combo', combo, name: m?.[1] ?? comboId, saved: false };
  }
  const t = TECHNIQUES.find((x) => x.label === name || x.key === name);
  if (t) return { kind: 'pattern', technique: t };
  return name ? { kind: 'setup', name } : { kind: 'manual' };
}

/**
 * The checks and readings at the entry bar, on a chart of 5-minute bars.
 * @param bars5     closed 5-minute bars of the index (options) or the share, a few days before the entry up to the end of the day
 * @param side      'CE' for a call or a share bought first, 'PE' for a put or a share sold first
 * @param chartOf   (bars5) => chart; builds it with the breadth and volume the live trader had (or without)
 */
export function entryReasons({ bars5, entryTime, side, source, chartOf = (b) => buildChart(b), when = null }) {
  const i = entryBarIndex(bars5, entryTime);
  if (i < 20) return { bar: null, note: 'Not enough candles before the entry to read the chart.' };
  const chart = chartOf(bars5);
  const d = side === 'CE' ? 1 : -1;
  const bar = bars5[i];
  const day = dayOf(entryTime);
  const out = { bar: { time: bar.time, close: bar.close }, readings: readingsAt(chart, i) };
  const near = (s) => s.side === side && Math.abs(s.time - (bar.time + 300)) <= 300;
  if (source.kind === 'combo' && source.combo) {
    const combo = source.combo;
    const missing = missingData(combo, chart.have);
    out.text = describeCombo(combo);
    if (missing.length) {
      out.note = `This combination needs ${[...new Set(missing)].map((x) => (x === 'flow' ? 'the 50 stocks’ volume' : x === 'breadth' ? 'the 50-stock breadth' : x)).join(' and ')}, which is not saved for this day yet, so its checks cannot be read again.`;
      out.conditions = combo.conds.map((k) => ({ key: k, label: CONDITION_BY_KEY.get(k)?.label ?? k, text: CONDITION_BY_KEY.get(k)?.text ?? '', held: null }));
      return out;
    }
    out.conditions = heldConditions(chart, combo, d, i);
    out.need = combo.need;
    const sigs = comboSignals(chart, combo, { from: 15, windows: false, when }).filter((s) => dayOf(s.time - 300) === day);
    out.study = studyMatch(sigs, near, side);
  } else if (source.kind === 'pattern') {
    out.text = source.technique.text;
    const sigs = findSignals(prepare(bars5, null, null), { only: [source.technique.key], windows: false, when }).filter((s) => dayOf(s.time - 300) === day);
    out.study = studyMatch(sigs, near, side);
  }
  return out;
}

function studyMatch(sigs, near, side) {
  const same = sigs.filter((s) => s.side === side);
  const hit = sigs.find(near);
  return {
    matched: Boolean(hit),
    times: same.map((s) => s.time),
    text: hit
      ? 'The study sees the same signal on this bar, so live and study agree on this entry.'
      : same.length
        ? `The study does not see this signal on this bar. On this day it sees it at other times only, so this live entry would not be in a study's results.`
        : 'The study does not see this signal anywhere on this day. A live entry the study never takes is one reason live results differ from the study.',
  };
}

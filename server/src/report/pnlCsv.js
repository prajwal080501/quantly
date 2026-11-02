import { round2 } from '../utils/money.js';

// The profit and loss download: one row per closed trade, or one per day. A CSV opens in Excel and Google Sheets.

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (xs) => xs.map(cell).join(',');
const ist = (d) => (d ? new Date(new Date(d).getTime() + 19800000).toISOString().replace('T', ' ').slice(0, 19) : '');

/** @param positions closed positions (lean), oldest first */
export function pnlRows(positions) {
  return positions.map((p) => {
    const buyQty = p.buyQty || 0;
    const sellQty = p.sellQty || 0;
    const gross = round2(p.realizedPnl || 0);
    const charges = round2(p.charges || 0);
    return {
      day: p.tradingDay,
      opened: ist(p.openedAt),
      closed: ist(p.closedAt),
      symbol: p.symbol,
      segment: p.segment === 'OPT' ? 'Options' : 'Shares',
      direction: p.direction === 'SHORT' ? 'Sell first' : 'Buy first',
      qty: Math.max(buyQty, sellQty),
      avgBuy: buyQty ? round2(p.buyValue / buyQty) : '',
      avgSell: sellQty ? round2(p.sellValue / sellQty) : '',
      gross,
      charges,
      net: round2(gross - charges),
    };
  });
}

const TRADE_HEAD = ['Day', 'Opened (IST)', 'Closed (IST)', 'Symbol', 'Segment', 'Direction', 'Quantity', 'Average buy', 'Average sell', 'Profit before charges', 'Charges', 'Net profit or loss'];

/** One row per closed trade, with a total row at the end. */
export function tradesCsv(positions) {
  const rows = pnlRows(positions);
  const out = [line(TRADE_HEAD), ...rows.map((r) => line([r.day, r.opened, r.closed, r.symbol, r.segment, r.direction, r.qty, r.avgBuy, r.avgSell, r.gross, r.charges, r.net]))];
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  out.push(line(['Total', '', '', '', '', '', '', '', '', sum('gross'), sum('charges'), sum('net')]));
  return `${out.join('\n')}\n`;
}

/** One row per day: trades, wins, losses, and the money. */
export function daysCsv(positions) {
  const days = new Map();
  for (const r of pnlRows(positions)) {
    const d = days.get(r.day) ?? { trades: 0, wins: 0, losses: 0, gross: 0, charges: 0, net: 0 };
    d.trades += 1;
    if (r.net > 0) d.wins += 1;
    else d.losses += 1;
    d.gross += r.gross;
    d.charges += r.charges;
    d.net += r.net;
    days.set(r.day, d);
  }
  const head = ['Day', 'Trades', 'Won', 'Lost', 'Profit before charges', 'Charges', 'Net profit or loss', 'Running total'];
  let run = 0;
  const out = [line(head)];
  for (const [day, d] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    run += d.net;
    out.push(line([day, d.trades, d.wins, d.losses, round2(d.gross), round2(d.charges), round2(d.net), round2(run)]));
  }
  return `${out.join('\n')}\n`;
}

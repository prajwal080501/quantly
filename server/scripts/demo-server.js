// Demo API for the app guide screenshots. No database, no broker: every number comes from a made-up Nifty tape.
// Run: node scripts/demo-server.js  (port 5055). Used only by scripts/guide-shots.mjs.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { comboRoutes } from '../src/routes/combos.js';
import { runOptionsStudy } from '../src/study/optionsStudy.js';
import { OptionSettings } from '../src/models/OptionSettings.js';
import { AutoSettings } from '../src/models/AutoSettings.js';
import { TradeDefaults, rulesFor } from '../src/models/TradeDefaults.js';
import { optionRoutes } from '../src/routes/options.js';
import { autoRoutes } from '../src/routes/auto.js';
import { pnlSummary } from '../src/report/pnlSummary.js';

// Without a database every settings lookup finds nothing, so each screen shows the defaults.
const none = () => { const p = Promise.resolve(null); p.lean = () => Promise.resolve(null); return p; };
for (const M of [OptionSettings, AutoSettings, TradeDefaults]) { M.findOne = none; }
const today = { trades: 2, open: 0, spent: 0, pnl: 524 };
import { MockProvider } from '../src/market/providers/MockProvider.js';
import { MarketDataService } from '../src/market/MarketDataService.js';
import { marketRoutes } from '../src/routes/market.js';

const PORT = Number(process.env.DEMO_PORT || 5055);
const OPEN = Date.UTC(2026, 9, 5, 3, 45) / 1000;

function minutes(nDays, seed = 11) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  let price = 24000;
  for (let d = 0; d < nDays; d++) {
    let drift = 0;
    for (let m = 0; m < 375; m++) {
      if (m % 45 === 0) drift = (rnd() - 0.45) * 1.2;
      const o = price;
      const c = o + drift + (rnd() - 0.5) * 6;
      out.push({ time: OPEN + Math.floor(d / 5) * 7 * 86400 + (d % 5) * 86400 + m * 60, open: o, high: Math.max(o, c) + rnd() * 2, low: Math.min(o, c) - rnd() * 2, close: c, volume: 0 });
      price = c;
    }
  }
  return out;
}

const params = { iv: 0.14, lockStart: 1000, lockGap: 250, lotSize: 65, holidays: [], expiryWeekday: 2, days: 10, lossLimit: 3000, maxLots: 2, live: true, maxTrades: 3, dailyLoss: 3000 };
const result = await runOptionsStudy({ nifty1: minutes(14), params });
console.log('demo study ready:', Object.keys(result).join(','));

const market = new MarketDataService(new MockProvider({ intervalMs: 1000 }), {});
await market.start();
market.feedStatus = { connected: true, message: 'Demo feed' };
// Thirty made-up closed trades over three weeks, for the P&L screen.
const demoPositions = [];
{
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02'];
  for (const day of days) {
    for (let k = 0; k < 2; k++) {
      const win = rnd() < 0.58;
      const gross = Math.round((win ? 800 + rnd() * 3200 : -(900 + rnd() * 2300)));
      const hour = 3 + Math.floor(rnd() * 5);
      demoPositions.push({ tradingDay: day, openedAt: new Date(`${day}T0${hour}:${10 + k * 20}:00Z`), closedAt: new Date(`${day}T0${hour + 1}:05:00Z`), symbol: k ? 'NIFTY-23250-PE' : 'NIFTY-23300-CE', segment: 'OPT', direction: 'LONG', buyQty: 130, sellQty: 130, buyValue: 13000, sellValue: 13000 + gross, realizedPnl: gross, charges: 85 });
    }
  }
}
const demoPnl = pnlSummary(demoPositions);
const app = express();
app.use(express.json());
const user = { id: 'demo', name: 'Demo trader', email: 'demo@example.com' };
app.get('/api/auth/me', (_q, r) => r.json({ user }));
app.use('/api/market', marketRoutes({ market }));
app.use('/api/options', optionRoutes({ optionTrader: { todaySummary: async () => today, read: async () => ({ ready: false }) } }));
app.use('/api/auto', autoRoutes({ autoTrader: { todaySummary: async () => today } }));
app.get('/api/trade-defaults', (_q, r) => r.json({ shares: rulesFor(null, 'EQ'), options: rulesFor(null, 'OPT'), sensex: { own: false, ...rulesFor(null, 'OPT') } }));
app.get('/api/wallet', (_q, r) => r.json({ balance: 1038420, startingBalance: 1000000, usedMargin: 0, blockedMargin: 0, available: 1038420, realizedPnl: 38420, resetCount: 0, lastResetAt: null }));
app.get('/api/dashboard', (_q, r) => {
  const t = demoPnl.totals;
  r.json({
    totals: { realizedNet: t.net, unrealized: 0, totalPnl: t.net, totalCharges: t.charges, grossRealized: t.gross },
    stats: { trades: t.trades, wins: t.wins, losses: t.losses, winRate: t.winRate, avgWin: t.avgWin, avgLoss: t.avgLoss, profitFactor: t.profitFactor, best: t.best && { ...t.best, closedAt: '2026-10-20T06:00:00Z' }, worst: t.worst && { ...t.worst, closedAt: '2026-10-22T06:00:00Z' } },
    openPositions: [],
    equityCurve: demoPnl.cumulative.map((c) => ({ time: `${c.day}T10:00:00Z`, equity: c.total })),
    dailyPnl: demoPnl.cumulative.map((c) => ({ day: c.day, pnl: c.net })),
    breakdown: null,
  });
});
app.get('/api/signals/stats', (_q, r) => r.json({ total: 0, wins: 0, losses: 0, hitRate: null, recent: [] }));
app.get('/api/report/pnl-summary', (_q, r) => r.json(demoPnl));
app.use('/api/combos', comboRoutes());
app.get('/api/news/summary', (_q, r) => r.json({ signals: [], updatedAt: null }));
app.get('/api/study/:kind', (req, r) => r.json({ status: { state: 'done' }, result: req.params.kind === 'options' ? { ...result, demo: true } : null, note: 'DEMO DATA: made-up Nifty candles, for the app guide only.' }));
app.post('/api/study/:kind', (_q, r) => r.status(202).json({ status: { state: 'done' } }));
app.use('/api', (req, res) => { console.log('unhandled', req.method, req.originalUrl); res.json({}); });
const http = createServer(app);
new Server(http, { cors: { origin: true } }).on('connection', (sock) => sock.on('subscribe', () => {}));
http.listen(PORT, () => console.log('demo api on', PORT));

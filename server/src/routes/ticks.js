import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../utils/errors.js';
import { isRecorded } from '../ticks/tickRecorder.js';

export const TICKS_NOTE = 'Every second the Nifty index and the option contracts that stream are noted (price, volume and the five-level order book) while the market is open. The newest 3 trading days are kept and older days are deleted by themselves. Not recorded from the demo feed.';

const query = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  every: z.coerce.number().int().min(1).max(600).default(1), // keep one sample in every N seconds, to keep the answer small
});

export function tickRoutes({ recorder }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json({ ...recorder.status(), saved: await recorder.store.summary(), note: TICKS_NOTE });
  });

  router.get('/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isRecorded(symbol)) throw badRequest('Only the Nifty index and option contracts are recorded');
    const q = query.safeParse(req.query);
    if (!q.success) throw badRequest('Give a day like 2026-11-05');
    const { day, from = 0, to = Infinity, every } = q.data;
    const all = await recorder.store.read(symbol, day, from, to);
    const rows = every > 1 ? all.filter((_r, i) => i % every === 0) : all;
    res.json({ symbol, day, count: rows.length, rows: rows.slice(0, 25000) });
  });

  return router;
}

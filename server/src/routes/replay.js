import { Router } from 'express';
import mongoose from 'mongoose';
import { badRequest } from '../utils/errors.js';

// GET /api/replay/:positionId — one trade (share or option) minute by minute, with the entry details and why it ended as it did.
export function replayRoutes({ replay }) {
  const router = Router();
  router.get('/:positionId', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.positionId)) throw badRequest('That is not a trade id');
    res.json(await replay.replay(req.userId, req.params.positionId));
  });
  return router;
}

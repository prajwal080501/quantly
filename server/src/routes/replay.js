import { Router } from 'express';

export function replayRoutes({ replay }) {
  const router = Router();

  // One trade (a closed or open position, shares or options), minute by minute from entry to exit, with why it was taken.
  router.get('/:id', async (req, res) => {
    res.json(await replay.replay(req.userId, req.params.id));
  });

  return router;
}

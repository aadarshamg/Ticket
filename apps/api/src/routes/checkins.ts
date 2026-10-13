import { Router } from 'express';
import { requireAdmin, requireCsrf } from '../middleware/auth';
import { listConflicts } from '../services/offline';

/** Admin views over the check-in log. */
export function checkinsRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);

  // People admitted offline whose pass turned out to be used elsewhere, cancelled or not real
  router.get('/conflicts', async (_req, res) => {
    res.json(await listConflicts());
  });

  return router;
}

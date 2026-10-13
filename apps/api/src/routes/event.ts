import { Router } from 'express';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { eventInputSchema } from '../schemas/event';
import { getSettings, saveSettings } from '../services/eventSettings';

export function eventRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);

  router.get('/', async (_req, res) => {
    res.json(await getSettings());
  });

  router.put('/', async (req, res) => {
    const input = eventInputSchema.parse(req.body);
    res.json(await saveSettings(input, adminActor(req)));
  });

  return router;
}

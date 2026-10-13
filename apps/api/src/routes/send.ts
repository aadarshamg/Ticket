import { Router } from 'express';
import { z } from 'zod';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { getSendStatus, pauseSending, queueSend, resumeSending, sendTest } from '../services/sending';

const sendSchema = z
  .object({
    mode: z.enum(['unsent', 'failed', 'selected', 'reminder']),
    ticketIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
    limit: z.number().int().min(1, 'Must be at least 1').max(10_000).optional(),
  })
  .strict()
  .refine((value) => value.mode !== 'selected' || value.ticketIds !== undefined, {
    path: ['ticketIds'],
    message: 'Choose at least one booking',
  });

const testSchema = z
  .object({
    phones: z.array(z.string().trim().min(1)).min(1, 'Enter at least one number').max(10, 'At most 10 numbers'),
    ticketId: z.string().uuid().optional(),
  })
  .strict();

export function sendRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);

  // Queue messages: all unsent, failed only, selected IDs, or a reminder.
  router.post('/', async (req, res) => {
    res.status(202).json(await queueSend(sendSchema.parse(req.body), adminActor(req)));
  });

  router.get('/status', async (_req, res) => {
    res.json(await getSendStatus());
  });

  router.post('/pause', async (req, res) => {
    res.json(await pauseSending(adminActor(req)));
  });

  router.post('/resume', async (req, res) => {
    res.json(await resumeSending(adminActor(req)));
  });

  router.post('/test', async (req, res) => {
    const { phones, ticketId } = testSchema.parse(req.body);
    res.json(await sendTest(phones, ticketId, adminActor(req)));
  });

  return router;
}

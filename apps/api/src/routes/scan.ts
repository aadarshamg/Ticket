import { Router } from 'express';
import { z } from 'zod';
import { requireGate, requireGateCsrf } from '../middleware/auth';
import { createScanLimiter } from '../middleware/rateLimit';
import { admitAllRemaining, admitOne, lookupBookings, scanPass } from '../services/checkin';
import { buildOfflineList, syncOfflineCheckins } from '../services/offline';

const scanSchema = z.object({ qr: z.string().max(500), clientRef: z.string().uuid().optional() });
const syncSchema = z.object({
  checkins: z
    .array(
      z.object({
        clientRef: z.string().uuid(),
        qr: z.string().max(500),
        scannedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
      }),
    )
    .min(1)
    .max(100),
});
const ticketSchema = z.object({ ticketId: z.string().uuid() });
const lookupSchema = z.object({
  q: z.string().trim().min(3, 'Type an order ID or the last 4 digits of the phone number').max(64),
});

/** The gate scanner's API. Every route needs a gate session (PIN sign-in). */
export function scanRouter(): Router {
  const router = Router();
  router.use(requireGate, requireGateCsrf, createScanLimiter());

  // {qr} -> result; marks the pass used if it is valid
  router.post('/', async (req, res) => {
    const { qr, clientRef } = scanSchema.parse(req.body);
    res.json(await scanPass(qr, req.gate!, clientRef));
  });

  // Everyone still to come on a booking
  router.post('/admit-all', async (req, res) => {
    const { ticketId } = ticketSchema.parse(req.body);
    res.json(await admitAllRemaining(ticketId, req.gate!));
  });

  // One person on a booking, after a manual lookup
  router.post('/admit-one', async (req, res) => {
    const { ticketId } = ticketSchema.parse(req.body);
    res.json(await admitOne(ticketId, req.gate!));
  });

  // Manual lookup by order ID or last 4 phone digits
  router.get('/lookup', async (req, res) => {
    const { q } = lookupSchema.parse(req.query);
    res.json(await lookupBookings(q));
  });

  // Signed list of valid passes, for checking without a connection
  router.get('/offline-list', async (_req, res) => {
    res.json(await buildOfflineList());
  });

  // Admissions a phone made while offline
  router.post('/sync', async (req, res) => {
    const { checkins } = syncSchema.parse(req.body);
    res.json(await syncOfflineCheckins(checkins, req.gate!));
  });

  return router;
}

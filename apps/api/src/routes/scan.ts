import { Router } from 'express';
import { z } from 'zod';
import { requireGate, requireGateCsrf } from '../middleware/auth';
import { createScanLimiter } from '../middleware/rateLimit';
import { admitAllRemaining, admitOne, lookupBookings, scanPass } from '../services/checkin';

const scanSchema = z.object({ qr: z.string().max(500) });
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
    const { qr } = scanSchema.parse(req.body);
    res.json(await scanPass(qr, req.gate!));
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

  return router;
}

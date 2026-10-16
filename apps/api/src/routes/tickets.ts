import { Router } from 'express';
import { z } from 'zod';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { ticketCreateSchema, ticketListQuerySchema, ticketPatchSchema } from '../schemas/ticket';
import { resendTicket } from '../services/sending';
import { createTicket, listTickets, updateTicket } from '../services/tickets';

export function ticketsRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);

  // List / search / filter
  router.get('/', async (req, res) => {
    res.json(await listTickets(ticketListQuerySchema.parse(req.query)));
  });

  // Add one booking by hand, optionally sending its WhatsApp message straight away
  router.post('/', async (req, res) => {
    const input = ticketCreateSchema.parse(req.body);
    const ticket = await createTicket(input, adminActor(req));
    let sendError: string | null = null;
    if (input.sendNow) {
      try {
        await resendTicket(ticket.id, adminActor(req));
      } catch (error) {
        // The booking is saved either way; say why the message did not go.
        sendError = error instanceof Error ? error.message : 'The message could not be queued';
      }
    }
    res.status(201).json({ ticket, sendError });
  });

  // Edit or cancel
  router.patch('/:id', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'not_found', 'Booking not found');
    const patch = ticketPatchSchema.parse(req.body);
    res.json(await updateTicket(id.data, patch, adminActor(req)));
  });

  // Send (or resend) this booking's pass message
  router.post('/:id/resend', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'not_found', 'Booking not found');
    res.status(202).json(await resendTicket(id.data, adminActor(req)));
  });

  return router;
}

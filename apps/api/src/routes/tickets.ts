import { Router } from 'express';
import { z } from 'zod';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { ticketListQuerySchema, ticketPatchSchema } from '../schemas/ticket';
import { listTickets, updateTicket } from '../services/tickets';

export function ticketsRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);

  // List / search / filter
  router.get('/', async (req, res) => {
    res.json(await listTickets(ticketListQuerySchema.parse(req.query)));
  });

  // Edit or cancel
  router.patch('/:id', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'not_found', 'Booking not found');
    const patch = ticketPatchSchema.parse(req.body);
    res.json(await updateTicket(id.data, patch, adminActor(req)));
  });

  return router;
}

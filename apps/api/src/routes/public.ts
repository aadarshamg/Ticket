import { Router } from 'express';
import { HttpError } from '../middleware/errors';
import { createLookupLimiter } from '../middleware/rateLimit';
import { getBookingView, getPassView, parseCode } from '../services/publicPasses';

const notFound = () => new HttpError(404, 'not_found', 'Pass not found');

/**
 * Data for the public pass pages (/b/{code}, /p/{code}), fetched by the web app's server.
 * No sign-in: the unguessable code in the link is the credential.
 */
export function publicRouter(): Router {
  const router = Router();
  router.use(createLookupLimiter());

  router.get('/bookings/:code', async (req, res) => {
    const code = parseCode(req.params.code);
    const view = code ? await getBookingView(code) : null;
    if (!view) throw notFound();
    res.json(view);
  });

  router.get('/passes/:code', async (req, res) => {
    const code = parseCode(req.params.code);
    const view = code ? await getPassView(code) : null;
    if (!view) throw notFound();
    res.json(view);
  });

  return router;
}

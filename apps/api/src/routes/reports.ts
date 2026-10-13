import { Router } from 'express';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { auditQuerySchema, listAuditLog } from '../services/auditLog';
import { buildExportCsv } from '../services/exportCsv';
import { getStats } from '../services/stats';

/** GET /api/stats – live numbers for the dashboard. */
export function statsRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);
  router.get('/', async (_req, res) => {
    res.json(await getStats());
  });
  return router;
}

/** GET /api/export.csv – every booking with message status and passes used. */
export function exportRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);
  router.get('/', async (req, res) => {
    const { csv, rows } = await buildExportCsv();
    // The file holds every buyer's phone number: record who took a copy.
    await audit(prisma, adminActor(req), 'export.csv', undefined, { rows });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-${stamp}.csv"`);
    res.send(csv);
  });
  return router;
}

/** GET /api/audit – who did what, when. */
export function auditRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);
  router.get('/', async (req, res) => {
    res.json(await listAuditLog(auditQuerySchema.parse(req.query)));
  });
  return router;
}

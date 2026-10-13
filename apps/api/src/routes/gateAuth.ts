import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { GATE_COOKIE, gateCookieOptions, signGateSession } from '../lib/session';
import { requireGate, requireGateCsrf } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { createGateLoginLimiter } from '../middleware/rateLimit';
import { findGateByPin } from '../services/gates';

const loginSchema = z.object({
  pin: z.string({ required_error: 'Enter the gate PIN' }).regex(/^\d{4,8}$/, 'The PIN is 4 to 8 digits'),
  /** A phone keeps its ID between sign-ins so its check-ins can be traced; generated if absent. */
  deviceId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,40}$/)
    .optional(),
});

/** Sign-in for gate volunteers, mounted at /api/auth/gate. */
export function gateAuthRouter(): Router {
  const router = Router();

  router.post('/', createGateLoginLimiter(), async (req, res) => {
    const { pin, deviceId: givenDeviceId } = loginSchema.parse(req.body);

    const gate = await findGateByPin(pin);
    if (!gate) {
      await audit(prisma, { type: 'system', label: 'auth' }, 'gate.login_failed');
      throw new HttpError(401, 'invalid_pin', 'That PIN is not correct');
    }

    const deviceId = givenDeviceId ?? randomUUID();
    const csrf = randomBytes(24).toString('base64url');
    const token = await signGateSession({
      gateId: gate.id,
      gate: gate.name,
      deviceId,
      gateVersion: gate.updatedAt.getTime(),
      csrf,
    });
    await audit(prisma, { type: 'gate', id: gate.id, label: `${gate.name} / ${deviceId}` }, 'gate.login', {
      type: 'Gate',
      id: gate.id,
    });

    res.cookie(GATE_COOKIE, token, gateCookieOptions());
    res.json({ gate: gate.name, deviceId, csrfToken: csrf });
  });

  router.get('/me', requireGate, (req, res) => {
    const session = req.gate!;
    res.json({ gate: session.gate, deviceId: session.deviceId, csrfToken: session.csrf });
  });

  router.post('/logout', requireGate, requireGateCsrf, (_req, res) => {
    const { maxAge: _maxAge, ...clearOptions } = gateCookieOptions();
    res.clearCookie(GATE_COOKIE, clearOptions);
    res.status(204).end();
  });

  return router;
}

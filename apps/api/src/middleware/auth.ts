import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Actor } from '../lib/audit';
import {
  ADMIN_COOKIE,
  GATE_COOKIE,
  verifyAdminSession,
  verifyGateSession,
  type AdminSession,
  type GateSession,
} from '../lib/session';
import { isGateSessionCurrent } from '../services/gates';
import { HttpError } from './errors';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminSession;
    gate?: GateSession;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[ADMIN_COOKIE];
  const session = typeof token === 'string' ? await verifyAdminSession(token) : null;
  if (!session) {
    throw new HttpError(401, 'unauthenticated', 'Please sign in');
  }
  req.admin = session;
  next();
};

/** Must run after requireAdmin. Rejects writes that do not echo the session's CSRF token. */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const expected = req.admin?.csrf ?? '';
  const provided = req.get('x-csrf-token') ?? '';
  if (!expected || !safeEqual(provided, expected)) {
    throw new HttpError(403, 'csrf', 'Security token missing or expired. Reload the page and try again.');
  }
  next();
};

/** Gate volunteers: a valid scanner session whose gate is still active and unchanged. */
export const requireGate: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[GATE_COOKIE];
  const session = typeof token === 'string' ? await verifyGateSession(token) : null;
  if (!session || !(await isGateSessionCurrent(session.gateId, session.gateVersion))) {
    throw new HttpError(401, 'unauthenticated', 'Enter the gate PIN to continue');
  }
  req.gate = session;
  next();
};

/** Must run after requireGate. Same idea as requireCsrf, for the scanner's writes. */
export const requireGateCsrf: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const expected = req.gate?.csrf ?? '';
  const provided = req.get('x-csrf-token') ?? '';
  if (!expected || !safeEqual(provided, expected)) {
    throw new HttpError(403, 'csrf', 'Security token missing or expired. Reload the page and try again.');
  }
  next();
};

export function adminActor(req: Request): Actor {
  if (!req.admin) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  return { type: 'admin', id: req.admin.adminId, label: req.admin.email };
}

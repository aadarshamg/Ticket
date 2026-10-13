import type { CookieOptions } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env';

export const ADMIN_COOKIE = 'tk_admin';
const ADMIN_AUDIENCE = 'admin';

const key = new TextEncoder().encode(env.SESSION_SECRET);

export interface AdminSession {
  adminId: string;
  email: string;
  name: string;
  /** Per-session CSRF token; the browser must echo it in X-CSRF-Token on writes. */
  csrf: string;
}

export async function signAdminSession(session: AdminSession): Promise<string> {
  return new SignJWT({ email: session.email, name: session.name, csrf: session.csrf })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.adminId)
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ADMIN_SESSION_HOURS}h`)
    .sign(key);
}

export async function verifyAdminSession(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      audience: ADMIN_AUDIENCE,
      algorithms: ['HS256'],
    });
    const { sub, email, name, csrf } = payload;
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      typeof name !== 'string' ||
      typeof csrf !== 'string'
    ) {
      return null;
    }
    return { adminId: sub, email, name, csrf };
  } catch {
    return null;
  }
}

export function adminCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: env.ADMIN_SESSION_HOURS * 60 * 60 * 1000,
  };
}

// --- Gate volunteers (the /scan page) ----------------------------------------

export const GATE_COOKIE = 'tk_gate';
const GATE_AUDIENCE = 'gate';

export interface GateSession {
  gateId: string;
  /** Gate name, recorded on every pass this session admits. */
  gate: string;
  /** Identifies the phone, so check-ins can be traced to a device. */
  deviceId: string;
  /** The gate's updatedAt when the volunteer signed in; a PIN reset or rename ends the session. */
  gateVersion: number;
  csrf: string;
}

export async function signGateSession(session: GateSession): Promise<string> {
  return new SignJWT({ gate: session.gate, deviceId: session.deviceId, gateVersion: session.gateVersion, csrf: session.csrf })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.gateId)
    .setAudience(GATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.GATE_SESSION_HOURS}h`)
    .sign(key);
}

export async function verifyGateSession(token: string): Promise<GateSession | null> {
  try {
    const { payload } = await jwtVerify(token, key, { audience: GATE_AUDIENCE, algorithms: ['HS256'] });
    const { sub, gate, deviceId, gateVersion, csrf } = payload;
    if (
      typeof sub !== 'string' ||
      typeof gate !== 'string' ||
      typeof deviceId !== 'string' ||
      typeof gateVersion !== 'number' ||
      typeof csrf !== 'string'
    ) {
      return null;
    }
    return { gateId: sub, gate, deviceId, gateVersion, csrf };
  } catch {
    return null;
  }
}

export function gateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: env.GATE_SESSION_HOURS * 60 * 60 * 1000,
  };
}

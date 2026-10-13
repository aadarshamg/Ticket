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

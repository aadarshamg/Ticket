import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { adminCookieOptions, signAdminSession, verifyAdminSession } from '../../src/lib/session';

const session = { adminId: 'a1b2', email: 'admin@test.local', name: 'Test Admin', csrf: 'csrf-token' };
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);

describe('admin session token', () => {
  it('round-trips', async () => {
    const token = await signAdminSession(session);
    expect(await verifyAdminSession(token)).toEqual(session);
  });

  it('rejects a tampered token', async () => {
    const token = await signAdminSession(session);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'someone-else' }),
    ).toString('base64url');
    expect(await verifyAdminSession(`${header}.${forgedPayload}.${signature}`)).toBeNull();
    expect(await verifyAdminSession('garbage')).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await new SignJWT({ email: session.email, name: session.name, csrf: session.csrf })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.adminId)
      .setAudience('admin')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-value-000000'));
    expect(await verifyAdminSession(token)).toBeNull();
  });

  it('rejects a token issued for a different audience', async () => {
    const token = await new SignJWT({ email: session.email, name: session.name, csrf: session.csrf })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.adminId)
      .setAudience('gate')
      .setExpirationTime('1h')
      .sign(key());
    expect(await verifyAdminSession(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ email: session.email, name: session.name, csrf: session.csrf })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.adminId)
      .setAudience('admin')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key());
    expect(await verifyAdminSession(token)).toBeNull();
  });

  it('uses an httpOnly, same-site cookie', () => {
    expect(adminCookieOptions()).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
  });
});

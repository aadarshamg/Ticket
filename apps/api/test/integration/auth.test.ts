import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { LOGIN_MAX_FAILED_ATTEMPTS } from '../../src/middleware/rateLimit';
import { ADMIN_EMAIL, ADMIN_PASSWORD, createAdmin, resetDb, signIn, validEventBody } from './helpers';

beforeEach(async () => {
  await resetDb();
  await createAdmin();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password and sets a hardened session cookie', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ email: `  ${ADMIN_EMAIL.toUpperCase()} `, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.admin).toMatchObject({ email: ADMIN_EMAIL, name: 'Test Admin' });
    expect(res.body.csrfToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toContain('tk_admin=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    expect(admin.lastLoginAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'admin.login', actorId: admin.id } })).toBe(1);
  });

  it('rejects a wrong password without setting a cookie, and logs the attempt', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { action: 'admin.login_failed' } })).toBe(1);
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('rejects a malformed body with field errors', async () => {
    const res = await request(createApp()).post('/api/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('blocks further attempts after too many failures', async () => {
    const app = createApp();
    for (let i = 0; i < LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'nope' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });
});

describe('admin session', () => {
  it('GET /api/auth/me needs a session', async () => {
    const app = createApp();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const { agent, csrf } = await signIn(app);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.admin.email).toBe(ADMIN_EMAIL);
    expect(me.body.csrfToken).toBe(csrf);
  });

  it('rejects a tampered session cookie', async () => {
    const res = await request(createApp())
      .get('/api/auth/me')
      .set('Cookie', 'tk_admin=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid');
    expect(res.status).toBe(401);
  });

  it('admin routes need a session, and writes need the CSRF token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/event')).status).toBe(401);
    expect((await request(app).put('/api/event').send(validEventBody())).status).toBe(401);

    const { agent, csrf } = await signIn(app);
    const noToken = await agent.put('/api/event').send(validEventBody());
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('csrf');

    const wrongToken = await agent.put('/api/event').set('X-CSRF-Token', 'wrong').send(validEventBody());
    expect(wrongToken.status).toBe(403);
    expect(await prisma.event.count()).toBe(0);

    const ok = await agent.put('/api/event').set('X-CSRF-Token', csrf).send(validEventBody());
    expect(ok.status).toBe(200);
  });

  it('logout clears the session', async () => {
    const { agent, csrf } = await signIn(createApp());
    const out = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
    expect(out.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

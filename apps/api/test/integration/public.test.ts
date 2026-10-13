import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db';
import { verifyQr } from '../../src/lib/qr';
import { LOOKUP_MAX_FAILED_ATTEMPTS } from '../../src/middleware/rateLimit';
import { createAdmin, createEvent, createTicket, resetDb } from './helpers';

beforeEach(async () => {
  await resetDb();
  await createAdmin();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const future = { endsAt: new Date(Date.now() + 86_400_000) };

describe('GET /api/public/bookings/:code', () => {
  it('returns the booking with a signed QR per pass, and nothing private', async () => {
    await createEvent({ ...future, helplineNumber: '+91 80 5550 0100', termsText: 'One person per pass.' });
    const ticket = await createTicket({
      orderId: 'ORD-1',
      name: 'Asha Kumari Raghunathan',
      phone: '+919876543210',
      email: 'asha@example.com',
      passCount: 3,
      used: [2],
    });

    // No sign-in needed; lower-case codes work too.
    const res = await request(createApp()).get(`/api/public/bookings/${ticket.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.event).toMatchObject({
      name: 'Winter Music Night',
      venue: 'Palace Grounds',
      city: 'Bengaluru',
      helplineNumber: '+91 80 5550 0100',
      termsText: 'One person per pass.',
      over: false,
    });
    expect(res.body.booking).toEqual({
      orderId: 'ORD-1',
      firstName: 'Asha',
      category: null,
      status: 'active',
      passCount: 3,
      usedCount: 1,
    });

    expect(res.body.passes.map((pass: { passNo: number; status: string }) => [pass.passNo, pass.status])).toEqual([
      [1, 'valid'],
      [2, 'used'],
      [3, 'valid'],
    ]);
    for (const [index, pass] of res.body.passes.entries()) {
      const stored = ticket.passes.find((p) => p.passNo === index + 1)!;
      expect(verifyQr(pass.qr)).toBe(stored.id); // the QR is this pass's signed ID
      expect(pass.shareUrl).toBe(`${env.PUBLIC_BASE_URL}/p/${stored.code}`);
    }
    expect(res.body.passes[1].usedAt).toEqual(expect.any(String));
    expect(res.body.passes[1].usedGate).toBe('Gate A');

    const body = JSON.stringify(res.body);
    for (const secret of ['9876543210', 'asha@example.com', 'Kumari', 'Raghunathan', ticket.id]) {
      expect(body, `must not expose ${secret}`).not.toContain(secret);
    }
    // The QR holds only the pass ID and signature.
    expect(res.body.passes[0].qr).not.toContain('ORD-1');
  });

  it('hides QR codes after the event ends and for cancelled bookings', async () => {
    await createEvent({ endsAt: new Date(Date.now() - 60_000) });
    const ended = await createTicket({ orderId: 'ORD-1', passCount: 2, used: [1] });
    const afterEvent = await request(createApp()).get(`/api/public/bookings/${ended.code}`);
    expect(afterEvent.body.event.over).toBe(true);
    expect(afterEvent.body.passes.map((pass: { qr: unknown }) => pass.qr)).toEqual([null, null]);

    await prisma.event.update({ where: { id: 1 }, data: future });
    const cancelled = await createTicket({ orderId: 'ORD-2', passCount: 2, status: 'cancelled' });
    const res = await request(createApp()).get(`/api/public/bookings/${cancelled.code}`);
    expect(res.body.booking.status).toBe('cancelled');
    expect(res.body.passes.map((pass: { status: string; qr: unknown }) => [pass.status, pass.qr])).toEqual([
      ['cancelled', null],
      ['cancelled', null],
    ]);
    // ...while an active booking gets its QR codes back once the event is in the future again.
    const live = await request(createApp()).get(`/api/public/bookings/${ended.code}`);
    expect(live.body.passes.every((pass: { qr: unknown }) => typeof pass.qr === 'string')).toBe(true);
  });
});

describe('GET /api/public/passes/:code', () => {
  it('returns only that pass: no buyer, no other passes, no booking link', async () => {
    await createEvent(future);
    const ticket = await createTicket({
      orderId: 'ORD-SECRET-1',
      name: 'Asha Raghunathan',
      phone: '+919876543210',
      email: 'asha@example.com',
      passCount: 4,
    });
    const pass = ticket.passes.find((p) => p.passNo === 2)!;

    const res = await request(createApp()).get(`/api/public/passes/${pass.code}`);
    expect(res.status).toBe(200);
    expect(res.body.pass).toEqual({
      passNo: 2,
      passCount: 4,
      status: 'valid',
      usedAt: null,
      usedGate: null,
      category: null,
      qr: expect.any(String),
    });
    expect(verifyQr(res.body.pass.qr)).toBe(pass.id);
    expect(res.body.event.name).toBe('Winter Music Night');
    expect(Object.keys(res.body).sort()).toEqual(['event', 'pass']);

    const body = JSON.stringify(res.body);
    const otherPasses = ticket.passes.filter((p) => p.id !== pass.id);
    const mustNotAppear = [
      '9876543210',
      'asha@example.com',
      'Asha',
      'Raghunathan',
      'ORD-SECRET-1',
      ticket.code, // would give access to the whole booking
      ticket.id,
      ...otherPasses.flatMap((p) => [p.code, p.id]),
    ];
    for (const secret of mustNotAppear) expect(body, `must not expose ${secret}`).not.toContain(secret);

    // A booking code is not a pass code, and vice versa.
    expect((await request(createApp()).get(`/api/public/passes/${ticket.code}`)).status).toBe(404);
    expect((await request(createApp()).get(`/api/public/bookings/${pass.code}`)).status).toBe(404);
  });
});

describe('unknown codes', () => {
  it('answers 404, and blocks an address that keeps guessing', async () => {
    await createEvent(future);
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const app = createApp();

    expect((await request(app).get('/api/public/bookings/ABCDEFGHJKLM')).status).toBe(404); // right shape, not issued
    expect((await request(app).get('/api/public/passes/short')).status).toBe(404);
    expect((await request(app).get(`/api/public/bookings/${encodeURIComponent("' OR 1=1 --")}`)).status).toBe(404);

    // Real lookups are not counted, however many there are.
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get(`/api/public/bookings/${ticket.code}`)).status).toBe(200);
    }
    for (let i = 3; i < LOOKUP_MAX_FAILED_ATTEMPTS; i++) {
      expect((await request(app).get('/api/public/passes/nope')).status).toBe(404);
    }
    const blocked = await request(app).get('/api/public/passes/nope');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });
});

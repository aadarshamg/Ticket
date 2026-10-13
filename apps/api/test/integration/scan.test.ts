import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { signPass } from '../../src/lib/qr';
import { SCAN_MAX_PER_WINDOW } from '../../src/middleware/rateLimit';
import { createAdmin, createEvent, createGate, createTicket, gateSignIn, resetDb, signIn, validEventBody } from './helpers';

let app: Express;
let gateA: Awaited<ReturnType<typeof gateSignIn>>;

const passOf = (ticket: Awaited<ReturnType<typeof createTicket>>, passNo: number) =>
  ticket.passes.find((pass) => pass.passNo === passNo)!;
const stored = (id: string) => prisma.pass.findUniqueOrThrow({ where: { id } });
const checkins = () => prisma.checkin.findMany({ orderBy: { scannedAt: 'asc' } });

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  await createEvent({ endsAt: new Date(Date.now() + 86_400_000) });
  await createGate('Gate A', '111111');
  await createGate('Gate B', '222222');
  app = createApp();
  gateA = await gateSignIn(app, '111111', 'phone-of-volunteer-1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/gate', () => {
  it('signs a volunteer in with the gate PIN and remembers the gate and device', async () => {
    const res = await request(app).post('/api/auth/gate').send({ pin: '222222' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ gate: 'Gate B', deviceId: expect.any(String), csrfToken: expect.any(String) });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toContain('tk_gate=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    // A phone keeps the device ID it already has.
    expect(gateA.deviceId).toBe('phone-of-volunteer-1');
    const me = await gateA.agent.get('/api/auth/gate/me');
    expect(me.body).toMatchObject({ gate: 'Gate A', deviceId: 'phone-of-volunteer-1' });
    expect(await prisma.auditLog.count({ where: { action: 'gate.login' } })).toBe(2);
  });

  it('refuses a wrong PIN, a malformed PIN and the PIN of a switched-off gate', async () => {
    await createGate('Closed Gate', '333333', false);
    const wrong = await request(app).post('/api/auth/gate').send({ pin: '999999' });
    expect(wrong.status).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect((await request(app).post('/api/auth/gate').send({ pin: '333333' })).status).toBe(401);
    expect((await request(app).post('/api/auth/gate').send({ pin: 'abc' })).status).toBe(400);
    expect((await request(app).post('/api/auth/gate').send({})).status).toBe(400);
  });

  it('keeps gate and admin access separate, and ends gate sessions when the PIN is reset', async () => {
    const admin = await signIn(app);
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const qr = signPass(passOf(ticket, 1).id);

    // An admin login cannot scan; a gate login cannot open admin pages; nobody can without signing in.
    expect((await admin.agent.post('/api/scan').set('X-CSRF-Token', admin.csrf).send({ qr })).status).toBe(401);
    expect((await gateA.agent.get('/api/tickets')).status).toBe(401);
    expect((await gateA.agent.get('/api/event')).status).toBe(401);
    expect((await request(app).post('/api/scan').send({ qr })).status).toBe(401);
    // Scanning needs the session's CSRF token.
    expect((await gateA.agent.post('/api/scan').send({ qr })).status).toBe(403);
    expect((await stored(passOf(ticket, 1).id)).status).toBe('valid');

    // The organiser resets Gate A's PIN: the volunteer's session stops working at once.
    const gates = await prisma.gate.findMany({ orderBy: { name: 'asc' } });
    const reset = await admin.agent
      .put('/api/event')
      .set('X-CSRF-Token', admin.csrf)
      .send(validEventBody({ endsAt: '2099-01-01T00:00:00+05:30', gates: gates.map((g) => ({ id: g.id, name: g.name, pin: g.name === 'Gate A' ? '444444' : undefined })) }));
    expect(reset.status).toBe(200);
    expect((await gateA.post('/api/scan', { qr })).status).toBe(401);
    expect((await request(app).post('/api/auth/gate').send({ pin: '111111' })).status).toBe(401);
    const again = await gateSignIn(app, '444444');
    expect((await again.post('/api/scan', { qr })).body.result).toBe('ok');
  });
});

describe('POST /api/scan', () => {
  it('admits a valid pass, marks it used, and shows the volunteer only name, category and counts', async () => {
    const ticket = await createTicket({
      orderId: 'ORD-SECRET-77',
      name: 'Asha Rao',
      phone: '+919876543210',
      email: 'asha@example.com',
      passCount: 4,
      used: [1],
    });
    const pass = passOf(ticket, 2);

    const res = await gateA.post('/api/scan', { qr: signPass(pass.id) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: 'ok',
      booking: { ticketId: ticket.id, name: 'Asha Rao', category: null, passCount: 4, remaining: 2 },
      pass: { passNo: 2, usedAt: expect.any(String), usedGate: 'Gate A' },
    });
    const body = JSON.stringify(res.body);
    for (const secret of ['9876543210', 'asha@example.com', 'ORD-SECRET-77', ticket.code]) {
      expect(body, `must not show ${secret}`).not.toContain(secret);
    }

    const after = await stored(pass.id);
    expect(after).toMatchObject({ status: 'used', usedGate: 'Gate A' });
    expect(Date.now() - after.usedAt!.getTime()).toBeLessThan(60_000);

    expect(await checkins()).toMatchObject([
      { passId: pass.id, gate: 'Gate A', deviceId: 'phone-of-volunteer-1', result: 'ok' },
    ]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'checkin.scan' } });
    expect(log).toMatchObject({ actorType: 'gate', entityType: 'Pass', entityId: pass.id });
    expect(log.actorLabel).toBe('Gate A / phone-of-volunteer-1');
  });

  it('says "already used", with the first entry time and gate, when a pass is scanned twice', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', name: 'Dev Shah', passCount: 2 });
    const qr = signPass(passOf(ticket, 1).id);
    const gateB = await gateSignIn(app, '222222');

    const first = await gateA.post('/api/scan', { qr });
    expect(first.body.result).toBe('ok');
    const usedAt = (await stored(passOf(ticket, 1).id)).usedAt!;

    // Someone tries the same pass again, at the other gate.
    const second = await gateB.post('/api/scan', { qr });
    expect(second.body).toMatchObject({
      result: 'already_used',
      booking: { name: 'Dev Shah', passCount: 2, remaining: 1 },
      pass: { passNo: 1, usedGate: 'Gate A', usedAt: usedAt.toISOString() },
    });

    // The record of the first entry is untouched, and both attempts are logged.
    expect(await stored(passOf(ticket, 1).id)).toMatchObject({ status: 'used', usedGate: 'Gate A', usedAt });
    expect((await checkins()).map((c) => [c.gate, c.result])).toEqual([
      ['Gate A', 'ok'],
      ['Gate B', 'already_used'],
    ]);
    // The other pass on the booking still works.
    expect((await gateB.post('/api/scan', { qr: signPass(passOf(ticket, 2).id) })).body.result).toBe('ok');
  });

  it('admits exactly one person when the same pass is scanned at several gates at the same moment', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const pass = passOf(ticket, 1);
    const qr = signPass(pass.id);
    const gateB = await gateSignIn(app, '222222', 'phone-of-volunteer-2');

    // Eight scans fired together, alternating between the two gates.
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? gateA : gateB).post('/api/scan', { qr })),
    );
    expect(responses.every((res) => res.status === 200)).toBe(true);

    const results = responses.map((res) => res.body.result as string);
    expect(results.filter((result) => result === 'ok')).toHaveLength(1);
    expect(results.filter((result) => result === 'already_used')).toHaveLength(7);

    // The stored gate is the gate of the one scan that won.
    const winner = responses.find((res) => res.body.result === 'ok')!;
    const after = await stored(pass.id);
    expect(after.status).toBe('used');
    expect(after.usedGate).toBe(winner.body.pass.usedGate);

    const log = await checkins();
    expect(log).toHaveLength(8);
    expect(log.filter((c) => c.result === 'ok')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'checkin.scan' } })).toBe(1);
  });

  it('rejects forged, altered and unknown codes as invalid, and logs each attempt', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 2 });
    const [one, two] = [passOf(ticket, 1), passOf(ticket, 2)];
    const real = signPass(one.id);

    const forgeries = [
      `${two.id}.${real.split('.')[1]}`, // pass 1's signature moved onto pass 2
      `${real.slice(0, -1)}${real.endsWith('A') ? 'B' : 'A'}`, // one character changed
      one.id, // the ID with no signature
      `https://example.com/b/${ticket.code}`, // some other QR code
      signPass(randomUUID()), // correctly signed, but no such pass (e.g. removed from the booking)
    ];
    for (const qr of forgeries) {
      const res = await gateA.post('/api/scan', { qr });
      expect(res.status).toBe(200);
      expect(res.body, qr).toEqual({ result: 'invalid' });
    }
    expect((await stored(one.id)).status).toBe('valid');
    expect((await stored(two.id)).status).toBe('valid');

    const log = await checkins();
    expect(log).toHaveLength(forgeries.length);
    expect(log.every((c) => c.result === 'invalid' && c.passId === null && c.gate === 'Gate A')).toBe(true);

    expect((await gateA.post('/api/scan', {})).status).toBe(400);
    expect((await gateA.post('/api/scan', { qr: 12345 })).status).toBe(400);
  });

  it('shows "cancelled" for a cancelled booking and does not admit', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', name: 'Meera Nair', passCount: 2, status: 'cancelled' });
    const pass = passOf(ticket, 1);

    const res = await gateA.post('/api/scan', { qr: signPass(pass.id) });
    expect(res.body).toMatchObject({ result: 'cancelled', booking: { name: 'Meera Nair', remaining: 0 } });
    expect((await stored(pass.id)).status).toBe('cancelled');
    expect(await checkins()).toMatchObject([{ passId: pass.id, result: 'cancelled' }]);
  });

  it('limits how fast one device can scan', async () => {
    const responses = await Promise.all(
      Array.from({ length: SCAN_MAX_PER_WINDOW + 1 }, () => gateA.post('/api/scan', { qr: 'not-a-pass' })),
    );
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(SCAN_MAX_PER_WINDOW);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);

    // Another volunteer's phone is not affected.
    const gateB = await gateSignIn(app, '222222');
    expect((await gateB.post('/api/scan', { qr: 'not-a-pass' })).status).toBe(200);
  });
});

describe('POST /api/scan/admit-all', () => {
  it('admits everyone still to come on a booking in one go', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', name: 'Asha Rao', passCount: 4, used: [1] });

    const res = await gateA.post('/api/scan/admit-all', { ticketId: ticket.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      admitted: 3,
      cancelled: false,
      booking: { ticketId: ticket.id, name: 'Asha Rao', category: null, passCount: 4, remaining: 0 },
    });

    const passes = await prisma.pass.findMany({ where: { ticketId: ticket.id }, orderBy: { passNo: 'asc' } });
    expect(passes.every((pass) => pass.status === 'used')).toBe(true);
    expect(passes.slice(1).every((pass) => pass.usedGate === 'Gate A' && pass.usedAt !== null)).toBe(true);
    expect(await prisma.checkin.count({ where: { result: 'ok', gate: 'Gate A' } })).toBe(3);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'checkin.admit_all' } });
    expect(log.meta).toEqual({ admitted: 3 });

    // Pressing it again admits nobody.
    expect((await gateA.post('/api/scan/admit-all', { ticketId: ticket.id })).body.admitted).toBe(0);
    expect(await prisma.checkin.count()).toBe(3);
  });

  it('admits nobody on a cancelled booking, and 404s for an unknown one', async () => {
    const cancelled = await createTicket({ orderId: 'ORD-1', passCount: 2, status: 'cancelled' });
    const res = await gateA.post('/api/scan/admit-all', { ticketId: cancelled.id });
    expect(res.body).toMatchObject({ admitted: 0, cancelled: true });
    expect(await prisma.pass.count({ where: { status: 'used' } })).toBe(0);

    expect((await gateA.post('/api/scan/admit-all', { ticketId: randomUUID() })).status).toBe(404);
    expect((await gateA.post('/api/scan/admit-all', { ticketId: 'nope' })).status).toBe(400);
  });

  it('never double-admits when "admit all" and single scans of the same booking collide', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 3 });
    const gateB = await gateSignIn(app, '222222');

    const [all, ...scans] = await Promise.all([
      gateA.post('/api/scan/admit-all', { ticketId: ticket.id }),
      ...ticket.passes.map((pass) => gateB.post('/api/scan', { qr: signPass(pass.id) })),
    ]);
    const admittedByScan = scans.filter((res) => res.body.result === 'ok').length;
    // Three people at most, however the requests interleave.
    expect(all!.body.admitted + admittedByScan).toBe(3);
    expect(await prisma.pass.count({ where: { ticketId: ticket.id, status: 'used' } })).toBe(3);
    expect(await prisma.checkin.count({ where: { result: 'ok' } })).toBe(3);
  });
});

describe('manual lookup', () => {
  it('finds a booking by exact order ID or the last four phone digits, showing no private details', async () => {
    const asha = await createTicket({
      orderId: 'ORD-1001',
      name: 'Asha Rao',
      phone: '+919876543210',
      email: 'asha@example.com',
      passCount: 3,
      used: [1],
    });
    await createTicket({ orderId: 'ORD-1002', name: 'Dev Shah', phone: '+919811113210', passCount: 1 });
    await createTicket({ orderId: 'ORD-1003', name: 'Meera Nair', phone: '+919800000000', passCount: 2, status: 'cancelled' });

    const byOrder = await gateA.agent.get('/api/scan/lookup').query({ q: 'ord-1001' });
    expect(byOrder.status).toBe(200);
    expect(byOrder.body).toEqual({
      results: [
        { ticketId: asha.id, name: 'Asha Rao', category: null, cancelled: false, passCount: 3, entered: 1, remaining: 2 },
      ],
    });
    const body = JSON.stringify(byOrder.body);
    for (const secret of ['9876543210', 'asha@example.com', 'ORD-1001', asha.code]) {
      expect(body, `must not show ${secret}`).not.toContain(secret);
    }

    // Two buyers share the last four digits 3210.
    const byPhone = await gateA.agent.get('/api/scan/lookup').query({ q: '3210' });
    expect(byPhone.body.results.map((r: { name: string }) => r.name)).toEqual(['Asha Rao', 'Dev Shah']);

    const cancelled = await gateA.agent.get('/api/scan/lookup').query({ q: 'ORD-1003' });
    expect(cancelled.body.results[0]).toMatchObject({ name: 'Meera Nair', cancelled: true, remaining: 0 });

    // Exact matches only: the scanner cannot be used to browse the booking list.
    expect((await gateA.agent.get('/api/scan/lookup').query({ q: 'ORD-100' })).body.results).toEqual([]);
    expect((await gateA.agent.get('/api/scan/lookup').query({ q: 'Asha' })).body.results).toEqual([]);
    expect((await gateA.agent.get('/api/scan/lookup').query({ q: '98765' })).body.results).toEqual([]);
    expect((await gateA.agent.get('/api/scan/lookup').query({ q: '32' })).status).toBe(400);
    expect((await request(app).get('/api/scan/lookup').query({ q: 'ORD-1001' })).status).toBe(401);
  });

  it('admits one person at a time, and never the same pass twice', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', name: 'Asha Rao', passCount: 3 });

    const first = await gateA.post('/api/scan/admit-one', { ticketId: ticket.id });
    expect(first.body).toMatchObject({
      result: 'ok',
      booking: { name: 'Asha Rao', passCount: 3, remaining: 2 },
      pass: { passNo: 1, usedGate: 'Gate A' },
    });

    // Two volunteers press "Admit 1" on the same booking at the same moment, and a third presses too.
    const gateB = await gateSignIn(app, '222222');
    const together = await Promise.all([
      gateA.post('/api/scan/admit-one', { ticketId: ticket.id }),
      gateB.post('/api/scan/admit-one', { ticketId: ticket.id }),
      gateB.post('/api/scan/admit-one', { ticketId: ticket.id }),
    ]);
    const admitted = together.filter((res) => res.body.result === 'ok');
    expect(admitted).toHaveLength(2); // only two passes were left
    expect(new Set(admitted.map((res) => res.body.pass.passNo))).toEqual(new Set([2, 3]));
    expect(together.filter((res) => res.body.result === 'already_used')).toHaveLength(1);

    expect(await prisma.pass.count({ where: { ticketId: ticket.id, status: 'used' } })).toBe(3);
    expect(await prisma.checkin.count({ where: { result: 'ok' } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'checkin.manual' } })).toBe(3);
  });
});

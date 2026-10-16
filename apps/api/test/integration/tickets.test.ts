import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { TICKET_TEMPLATE } from '../../src/config/constants';
import { prisma } from '../../src/db';
import { createAdmin, createEvent, createTicket, resetDb, signIn } from './helpers';

let app: Express;
let agent: TestAgent;
let csrf: string;

const list = async (query: Record<string, string | number> = {}) => {
  const res = await agent.get('/api/tickets').query(query);
  expect(res.status).toBe(200);
  return res.body as { items: Record<string, unknown>[]; total: number; page: number; pageSize: number };
};
const orderIds = async (query: Record<string, string | number>) =>
  (await list(query)).items.map((item) => item.orderId).sort();

const patch = (id: string, body: Record<string, unknown>) =>
  agent.patch(`/api/tickets/${id}`).set('X-CSRF-Token', csrf).send(body);

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  await createEvent();
  app = createApp();
  ({ agent, csrf } = await signIn(app));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/tickets', () => {
  it('lists, searches, filters and pages bookings', async () => {
    const asha = await createTicket({ orderId: 'ORD-1', name: 'Asha Rao', phone: '+919876543210', passCount: 3 });
    const dev = await createTicket({ orderId: 'ORD-2', name: 'Dev Shah', phone: '+919811122233', passCount: 2, used: [1] });
    const meera = await createTicket({
      orderId: 'VIP-9',
      name: 'Meera Nair',
      phone: '+919900000001',
      email: 'meera@example.com',
      passCount: 2,
      used: [1, 2],
    });
    await createTicket({ orderId: 'ORD-4', name: 'Gone Away', passCount: 1, status: 'cancelled' });
    await prisma.message.create({ data: { ticketId: asha.id, template: TICKET_TEMPLATE, status: 'delivered' } });
    await prisma.message.create({
      data: { ticketId: dev.id, template: TICKET_TEMPLATE, status: 'failed', errorText: 'Not on WhatsApp' },
    });
    // A message for another template must not count as "sent the ticket".
    await prisma.message.create({ data: { ticketId: meera.id, template: 'event_reminder_v1', status: 'sent' } });

    const all = await list();
    expect(all.total).toBe(4);
    const devItem = all.items.find((item) => item.orderId === 'ORD-2');
    expect(devItem).toMatchObject({
      name: 'Dev Shah',
      phone: '+919811122233',
      passCount: 2,
      usedCount: 1,
      status: 'active',
      messageStatus: 'failed',
      messageError: 'Not on WhatsApp',
    });
    expect(all.items.find((item) => item.orderId === 'VIP-9')).toMatchObject({ messageStatus: 'unsent', usedCount: 2 });

    // Each case is [query, expected order IDs]; run a few at a time to keep the test quick.
    const cases: [Record<string, string>, string[]][] = [
      // search: name, order ID, email (case-insensitive) and phone digits
      [{ q: 'asha' }, ['ORD-1']],
      [{ q: 'vip-9' }, ['VIP-9']],
      [{ q: 'MEERA@EXAMPLE' }, ['VIP-9']],
      [{ q: '2233' }, ['ORD-2']],
      [{ q: '98111 22233' }, ['ORD-2']],
      // digits inside an order ID must not be matched against phone numbers ("+9199000 00001")
      [{ q: 'ORD-00001' }, []],
      [{ q: 'nobody' }, []],
      // filters
      [{ entryStatus: 'none' }, ['ORD-1', 'ORD-4']],
      [{ entryStatus: 'partial' }, ['ORD-2']],
      [{ entryStatus: 'full' }, ['VIP-9']],
      [{ messageStatus: 'unsent' }, ['ORD-4', 'VIP-9']],
      [{ messageStatus: 'failed' }, ['ORD-2']],
      [{ messageStatus: 'delivered' }, ['ORD-1']],
      [{ status: 'cancelled' }, ['ORD-4']],
      [{ status: 'active', messageStatus: 'unsent' }, ['VIP-9']],
    ];
    for (let i = 0; i < cases.length; i += 5) {
      const batch = cases.slice(i, i + 5);
      const results = await Promise.all(batch.map(([query]) => orderIds(query)));
      batch.forEach(([query, expected], index) => {
        expect(results[index], JSON.stringify(query)).toEqual(expected);
      });
    }

    // paging
    const page2 = await list({ pageSize: 3, page: 2 });
    expect(page2).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(page2.items).toHaveLength(1);

    expect((await agent.get('/api/tickets').query({ entryStatus: 'bogus' })).status).toBe(400);
    expect((await request(app).get('/api/tickets')).status).toBe(401);
  });
});

describe('PATCH /api/tickets/:id', () => {
  it('edits name and phone, normalising the phone and logging field names only', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', name: 'Asha Rao', phone: '+919876543210', passCount: 2 });

    const res = await patch(ticket.id, { name: '  Asha R. Rao ', phone: '098765 00000' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Asha R. Rao', phone: '+919876500000', passCount: 2 });

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ticket.update' } });
    expect(log.meta).toMatchObject({ via: 'admin', orderId: 'ORD-1', changes: ['name', 'phone'] });
    expect(JSON.stringify(log.meta)).not.toContain('9876500000');

    const badPhone = await patch(ticket.id, { phone: '12345' });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error.details).toEqual([{ path: 'phone', message: 'phone has 5 digits' }]);

    expect((await patch(ticket.id, { name: 'A' })).status).toBe(400);
    expect((await patch(ticket.id, {})).status).toBe(400);
    expect((await patch(ticket.id, { orderId: 'HACK' })).status).toBe(400); // unknown fields are rejected
    expect((await patch('3f1c2b9e-8a4d-4c6f-9b1a-2d3e4f5a6b7c', { name: 'Nobody' })).status).toBe(404);
    expect((await agent.patch(`/api/tickets/${ticket.id}`).send({ name: 'No Token' })).status).toBe(403);
  });

  it('changes the pass count, but never deletes a used pass', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 3, used: [3] });
    const usedPass = ticket.passes.find((pass) => pass.passNo === 3)!;

    const up = await patch(ticket.id, { passCount: 5 });
    expect(up.body).toMatchObject({ passCount: 5, usedCount: 1 });
    expect(await prisma.pass.count({ where: { ticketId: ticket.id } })).toBe(5);

    const down = await patch(ticket.id, { passCount: 2 });
    expect(down.status).toBe(200);
    const passes = await prisma.pass.findMany({ where: { ticketId: ticket.id }, orderBy: { passNo: 'asc' } });
    expect(passes.map((pass) => [pass.passNo, pass.status])).toEqual([
      [1, 'valid'],
      [2, 'used'],
    ]);
    expect(passes[1]!.id).toBe(usedPass.id);

    await prisma.pass.updateMany({ where: { ticketId: ticket.id }, data: { status: 'used' } });
    const refused = await patch(ticket.id, { passCount: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual([
      { path: 'passCount', message: 'cannot reduce to 1 pass: 2 already used' },
    ]);
    expect(await prisma.pass.count({ where: { ticketId: ticket.id } })).toBe(2);

    const overLimit = await patch(ticket.id, { passCount: 11 });
    expect(overLimit.status).toBe(400);
    expect(overLimit.body.error.details).toEqual([{ path: 'passCount', message: 'Must be at most 10' }]);
  });

  it('cancels a booking and its unused passes, and can restore it', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 3, used: [1] });
    const statuses = async () =>
      (await prisma.pass.findMany({ where: { ticketId: ticket.id }, orderBy: { passNo: 'asc' } })).map(
        (pass) => pass.status,
      );

    const cancelled = await patch(ticket.id, { status: 'cancelled' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', usedCount: 1 });
    expect(await statuses()).toEqual(['used', 'cancelled', 'cancelled']);

    // A pass added while cancelled is cancelled too.
    await patch(ticket.id, { passCount: 4 });
    expect(await statuses()).toEqual(['used', 'cancelled', 'cancelled', 'cancelled']);

    const restored = await patch(ticket.id, { status: 'active' });
    expect(restored.body).toMatchObject({ status: 'active' });
    expect(await statuses()).toEqual(['used', 'valid', 'valid', 'valid']);

    const actions = (
      await prisma.auditLog.findMany({ where: { entityId: ticket.id }, orderBy: { createdAt: 'asc' } })
    ).map((log) => log.action);
    expect(actions).toEqual(['ticket.cancel', 'ticket.update', 'ticket.restore']);
  });
});

describe('POST /api/tickets (add a booking by hand)', () => {
  const add = (body: Record<string, unknown>) => agent.post('/api/tickets').set('X-CSRF-Token', csrf).send(body);

  it('adds a booking with its passes, making up an order ID when none is given', async () => {
    const res = await add({ name: 'Ravi Kumar', phone: '98765 43210', passCount: 3, category: 'Guest list' });
    expect(res.status).toBe(201);
    expect(res.body.sendError).toBeNull();
    expect(res.body.ticket).toMatchObject({ name: 'Ravi Kumar', phone: '+919876543210', passCount: 3, category: 'Guest list', messageStatus: 'unsent' });
    expect(res.body.ticket.orderId).toMatch(/^ADD-[2-9A-HJ-NP-Z]{5}$/);
    expect(await prisma.pass.count({ where: { ticketId: res.body.ticket.id, status: 'valid' } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'ticket.create' } })).toBe(1);
  });

  it('keeps a given order ID, and refuses one that is taken or a bad phone', async () => {
    expect((await add({ orderId: 'WALK-1', name: 'Asha Rao', phone: '9876543210', passCount: 1 })).body.ticket.orderId).toBe('WALK-1');
    const taken = await add({ orderId: 'WALK-1', name: 'Dev Shah', phone: '9811122233', passCount: 1 });
    expect(taken.status).toBe(409);
    expect(taken.body.error.details).toEqual([{ path: 'orderId', message: 'Another booking already has this order ID' }]);
    const badPhone = await add({ name: 'Dev Shah', phone: '12345', passCount: 1 });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error.details[0].path).toBe('phone');
  });

  it('on a multi-night event, needs the night, and the night can be changed later', async () => {
    await prisma.event.update({
      where: { id: 1 },
      data: { startsAt: new Date('2026-11-14T18:00:00+05:30'), gatesOpenAt: new Date('2026-11-14T17:30:00+05:30'), endsAt: new Date('2026-11-15T23:00:00+05:30') },
    });
    const missing = await add({ name: 'Ravi Kumar', phone: '9876543210', passCount: 2 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0]).toEqual({ path: 'night', message: 'Choose the night: Sat, 14 Nov or Sun, 15 Nov' });

    const added = await add({ name: 'Ravi Kumar', phone: '9876543210', passCount: 2, night: '2026-11-14' });
    expect(added.body.ticket.night).toBe('2026-11-14');
    const moved = await patch(added.body.ticket.id, { night: '2026-11-15' });
    expect(moved.status).toBe(200);
    expect(moved.body.night).toBe('2026-11-15');
    expect((await patch(added.body.ticket.id, { night: '2026-11-20' })).status).toBe(400);
  });
});

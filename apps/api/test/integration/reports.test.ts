import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { TICKET_TEMPLATE } from '../../src/config/constants';
import { prisma } from '../../src/db';
import { signPass } from '../../src/lib/qr';
import { planPurge, purgeBookingData } from '../../src/services/purge';
import { createAdmin, createEvent, createGate, createTicket, gateSignIn, resetDb, signIn } from './helpers';

let app: Express;
let agent: TestAgent;
let csrf: string;

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  await createEvent({ endsAt: new Date(Date.now() + 86_400_000) });
  app = createApp();
  ({ agent, csrf } = await signIn(app));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Parses the export back into rows of cells (handles quoted cells; enough for these tests). */
function parseCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .trim()
    .split('\r\n')
    .map((line) => {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        if (quoted) {
          if (char === '"' && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else if (char === '"') quoted = false;
          else cell += char;
        } else if (char === '"') quoted = true;
        else if (char === ',') {
          cells.push(cell);
          cell = '';
        } else cell += char;
      }
      cells.push(cell);
      return cells;
    });
}

describe('GET /api/stats', () => {
  it('counts bookings, passes, messages, people entered and entries per gate', async () => {
    await createGate('Gate A', '111111');
    await createGate('Gate B', '222222');
    const a = await createTicket({ orderId: 'ORD-1', passCount: 4 });
    const b = await createTicket({ orderId: 'ORD-2', passCount: 2 });
    const c = await createTicket({ orderId: 'ORD-3', passCount: 3 });
    await createTicket({ orderId: 'ORD-4', passCount: 2, status: 'cancelled' });
    await prisma.message.createMany({
      data: [
        { ticketId: a.id, template: TICKET_TEMPLATE, status: 'read' },
        { ticketId: b.id, template: TICKET_TEMPLATE, status: 'failed' },
        { ticketId: c.id, template: 'event_reminder_v1', status: 'sent' }, // a reminder is not "the ticket was sent"
      ],
    });

    // Three people come in at Gate A, one at Gate B.
    const gateA = await gateSignIn(app, '111111');
    const gateB = await gateSignIn(app, '222222');
    for (const passNo of [1, 2]) await gateA.post('/api/scan', { qr: signPass(a.passes.find((p) => p.passNo === passNo)!.id) });
    await gateA.post('/api/scan', { qr: signPass(b.passes[0]!.id) });
    await gateB.post('/api/scan', { qr: signPass(c.passes[0]!.id) });

    const res = await agent.get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bookings: { total: 4, active: 3, cancelled: 1 },
      passes: { total: 11, valid: 5, used: 4, cancelled: 2 },
      messages: { unsent: 1, queued: 0, sent: 0, delivered: 0, read: 1, failed: 1 },
      entered: 4,
      stillToCome: 5,
      conflicts: 0,
    });
    expect(res.body.gates).toEqual([
      { gate: 'Gate A', entered: 3, lastEntryAt: expect.any(String) },
      { gate: 'Gate B', entered: 1, lastEntryAt: expect.any(String) },
    ]);
    expect(Date.now() - new Date(res.body.generatedAt).getTime()).toBeLessThan(60_000);

    expect((await request(app).get('/api/stats')).status).toBe(401);
    expect((await gateA.agent.get('/api/stats')).status).toBe(401); // volunteers do not get the dashboard
  });
});

describe('GET /api/export.csv', () => {
  it('exports every booking with message status and passes used, safely for Excel', async () => {
    await createGate('Gate A', '111111');
    const asha = await createTicket({
      orderId: 'ORD-1',
      name: 'Rao, Asha "AR"',
      phone: '+919876543210',
      email: 'asha@example.com',
      passCount: 3,
    });
    await prisma.ticket.update({ where: { id: asha.id }, data: { amount: 2397, category: 'VIP' } });
    await createTicket({ orderId: 'ORD-2', name: '=HYPERLINK("http://evil.example")', passCount: 1, status: 'cancelled' });
    await createTicket({ orderId: 'ORD-3', name: 'आशा राव', passCount: 2 });
    await prisma.message.create({
      data: { ticketId: asha.id, template: TICKET_TEMPLATE, status: 'failed', errorText: 'Recipient is not on WhatsApp' },
    });
    const gate = await gateSignIn(app, '111111');
    await gate.post('/api/scan', { qr: signPass(asha.passes[0]!.id) });

    const res = await agent.get('/api/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // so Excel reads it as UTF-8

    const [header, ...rows] = parseCsv(res.text);
    expect(header).toEqual([
      'order_id', 'name', 'phone', 'email', 'category', 'night', 'amount', 'passes', 'passes_used', 'passes_remaining',
      'booking_status', 'message_status', 'message_error', 'first_entry_ist', 'last_entry_ist', 'gates',
    ]);
    expect(rows).toHaveLength(3);
    const row = (orderId: string) => Object.fromEntries(rows.find((r) => r[0] === orderId)!.map((cell, i) => [header![i], cell]));

    expect(row('ORD-1')).toMatchObject({
      name: 'Rao, Asha "AR"', // commas and quotes survive the round trip
      phone: '+919876543210',
      email: 'asha@example.com',
      category: 'VIP',
      amount: '2397.00',
      passes: '3',
      passes_used: '1',
      passes_remaining: '2',
      booking_status: 'active',
      message_status: 'failed',
      message_error: 'Recipient is not on WhatsApp',
      gates: 'Gate A',
    });
    expect(row('ORD-1').first_entry_ist).toMatch(/^\w+day, \d{1,2} \w{3} \d{4} \d{2}:\d{2}$/);
    // A name that looks like a formula is exported as text.
    expect(row('ORD-2')).toMatchObject({ name: '\'=HYPERLINK("http://evil.example")', booking_status: 'cancelled', message_status: 'unsent', passes_remaining: '0' });
    expect(row('ORD-3')).toMatchObject({ name: 'आशा राव', passes_used: '0', first_entry_ist: '', gates: '' });

    // Taking a copy of everyone's phone numbers is itself recorded.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'export.csv' } });
    expect(log).toMatchObject({ actorType: 'admin', meta: { rows: 3 } });

    expect((await request(app).get('/api/export.csv')).status).toBe(401);
    expect((await gate.agent.get('/api/export.csv')).status).toBe(401);
  });
});

describe('GET /api/audit', () => {
  it('lists who did what, newest first, with filters and paging', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    await agent.patch(`/api/tickets/${ticket.id}`).set('X-CSRF-Token', csrf).send({ name: 'New Name' });
    await agent.patch(`/api/tickets/${ticket.id}`).set('X-CSRF-Token', csrf).send({ status: 'cancelled' });

    const all = await agent.get('/api/audit');
    expect(all.status).toBe(200);
    expect(all.body.items.map((item: { action: string }) => item.action)).toEqual(['ticket.cancel', 'ticket.update', 'admin.login']);
    expect(all.body.items[1]).toMatchObject({
      actorType: 'admin',
      actorLabel: 'admin@test.local',
      action: 'ticket.update',
      entityType: 'Ticket',
      entityId: ticket.id,
      meta: { via: 'admin', changes: ['name'] },
    });
    expect(all.body).toMatchObject({ total: 3, page: 1 });

    const bookings = await agent.get('/api/audit').query({ group: 'bookings' });
    expect(bookings.body.items.map((item: { action: string }) => item.action)).toEqual(['ticket.cancel', 'ticket.update']);
    expect((await agent.get('/api/audit').query({ group: 'signins' })).body.total).toBe(1);
    expect((await agent.get('/api/audit').query({ q: 'ADMIN@TEST' })).body.total).toBe(3);
    expect((await agent.get('/api/audit').query({ q: 'someone-else' })).body.total).toBe(0);

    const paged = await agent.get('/api/audit').query({ pageSize: 2, page: 2 });
    expect(paged.body.items.map((item: { action: string }) => item.action)).toEqual(['admin.login']);

    expect((await agent.get('/api/audit').query({ group: 'nonsense' })).status).toBe(400);
    expect((await request(app).get('/api/audit')).status).toBe(401);
  });
});

describe('purge-data', () => {
  it('is due 30 days after the event ends, and reports what it would delete without deleting', async () => {
    await createTicket({ orderId: 'ORD-1', passCount: 3 });
    const plan = await planPurge();
    expect(plan).toMatchObject({ eventName: 'Winter Music Night', due: false, counts: { bookings: 1, passes: 3 } });
    expect(await prisma.ticket.count()).toBe(1); // planning changes nothing

    const event = await prisma.event.findUniqueOrThrow({ where: { id: 1 } });
    const day = 86_400_000;
    expect((await planPurge(new Date(event.endsAt.getTime() + 29 * day))).due).toBe(false);
    expect((await planPurge(new Date(event.endsAt.getTime() + 30 * day))).due).toBe(true);
    expect(plan.dueAt!.getTime()).toBe(event.endsAt.getTime() + 30 * day);
  });

  it('removes all booking data and identifying audit details, keeping settings, gates and logins', async () => {
    await createGate('Gate A', '111111');
    const ticket = await createTicket({ orderId: 'ORD-SECRET', name: 'Asha Rao', phone: '+919876543210', email: 'asha@example.com', passCount: 2 });
    await prisma.message.create({ data: { ticketId: ticket.id, template: TICKET_TEMPLATE, status: 'delivered', waMessageId: 'wamid.X' } });
    const gate = await gateSignIn(app, '111111');
    await gate.post('/api/scan', { qr: signPass(ticket.passes[0]!.id) });
    await agent.patch(`/api/tickets/${ticket.id}`).set('X-CSRF-Token', csrf).send({ name: 'Asha R' });
    await request(app).post('/api/auth/login').send({ email: 'buyer.typo@example.com', password: 'x' });

    const counts = await purgeBookingData();
    expect(counts).toMatchObject({ bookings: 1, passes: 2, messages: 1, checkins: 1, uploads: 1 });
    // The booking edit (order ID) and the failed login (email typed). The scan entry holds no details.
    expect(counts.auditEntriesScrubbed).toBe(2);

    for (const table of ['ticket', 'pass', 'message', 'checkin', 'upload'] as const) {
      expect(await (prisma[table] as { count: () => Promise<number> }).count(), table).toBe(0);
    }
    // No trace of the buyer is left anywhere in the database.
    const everything = JSON.stringify(await prisma.auditLog.findMany());
    for (const secret of ['ORD-SECRET', 'Asha', '9876543210', 'asha@example.com', 'buyer.typo@example.com']) {
      expect(everything, `audit log still contains ${secret}`).not.toContain(secret);
    }
    // The audit trail itself survives (what happened and when), and the purge is recorded.
    const actions = (await prisma.auditLog.findMany()).map((log) => log.action);
    expect(actions).toEqual(expect.arrayContaining(['ticket.update', 'checkin.scan', 'admin.login_failed', 'data.purge']));
    const purge = await prisma.auditLog.findFirstOrThrow({ where: { action: 'data.purge' } });
    expect(purge.meta).toMatchObject({ bookings: 1, passes: 2 });

    // What the organiser still needs is untouched.
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.gate.count()).toBe(1);
    expect(await prisma.adminUser.count()).toBe(1);
    expect((await agent.get('/api/stats')).body).toMatchObject({ bookings: { total: 0 }, entered: 0 });
  });
});

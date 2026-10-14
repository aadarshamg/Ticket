import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { istDateKey } from '../../src/lib/nights';
import { signPass } from '../../src/lib/qr';
import { buildTicketMessage } from '../../src/messaging/templates';
import { createAdmin, createEvent, createGate, createTicket, gateSignIn, resetDb, signIn } from './helpers';

// A two-night event whose first night is "tonight" whenever the tests run: the night the gates
// are checking is the India date six hours ago (so the small hours still count as the night before).
const DAY = 86_400_000;
const tonight = istDateKey(Date.now() - 6 * 3_600_000);
const tomorrow = istDateKey(Date.parse(`${tonight}T12:00:00Z`) + DAY);
const at = (night: string, time: string) => new Date(`${night}T${time}:00+05:30`);

let app: Express;
let gate: Awaited<ReturnType<typeof gateSignIn>>;

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  await createEvent({
    gatesOpenAt: at(tonight, '18:30'),
    startsAt: at(tonight, '19:00'),
    endsAt: at(tomorrow, '23:59'),
  });
  await createGate('Gate A', '111111');
  app = createApp();
  gate = await gateSignIn(app, '111111', 'phone-of-volunteer-1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('scanning on a multi-night event', () => {
  it("admits tonight's passes and passes for any night, and turns the other night's away", async () => {
    const tonights = await createTicket({ orderId: 'TONIGHT', passCount: 1, night: tonight });
    const anyNight = await createTicket({ orderId: 'ANY', passCount: 1 });
    const other = await createTicket({ orderId: 'TOMORROW', passCount: 2, night: tomorrow });

    const scan = (passId: string) => gate.post('/api/scan', { qr: signPass(passId) });

    expect((await scan(tonights.passes[0]!.id)).body).toMatchObject({ result: 'ok', booking: { night: tonight } });
    expect((await scan(anyNight.passes[0]!.id)).body).toMatchObject({ result: 'ok', booking: { night: null } });

    const wrong = await scan(other.passes[0]!.id);
    expect(wrong.body).toMatchObject({ result: 'wrong_night', booking: { night: tomorrow, remaining: 2 } });
    // The pass is still good for its own night, and the attempt is logged.
    expect((await prisma.pass.findUniqueOrThrow({ where: { id: other.passes[0]!.id } })).status).toBe('valid');
    expect(await prisma.checkin.count({ where: { result: 'wrong_night' } })).toBe(1);
  });

  it('refuses admit-all, admit-one and lookup admission for the other night', async () => {
    const other = await createTicket({ orderId: 'TOMORROW', passCount: 3, night: tomorrow });

    const all = await gate.post('/api/scan/admit-all', { ticketId: other.id });
    expect(all.body).toMatchObject({ admitted: 0, wrongNight: true, booking: { night: tomorrow, remaining: 3 } });

    const one = await gate.post('/api/scan/admit-one', { ticketId: other.id });
    expect(one.body).toMatchObject({ result: 'wrong_night' });

    const lookup = await gate.agent.get('/api/scan/lookup').query({ q: 'TOMORROW' });
    expect(lookup.body.results).toEqual([expect.objectContaining({ night: tomorrow, wrongNight: true, remaining: 3 })]);
    expect(await prisma.pass.count({ where: { ticketId: other.id, status: 'used' } })).toBe(0);
  });

  it("puts only tonight's passes (and any-night ones) on the offline list", async () => {
    const tonights = await createTicket({ orderId: 'TONIGHT', passCount: 2, night: tonight });
    await createTicket({ orderId: 'ANY', passCount: 1 });
    await createTicket({ orderId: 'TOMORROW', passCount: 4, night: tomorrow });
    const list = await gate.agent.get('/api/scan/offline-list');
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(3);
    expect(tonights.passes).toHaveLength(2);
  });
});

describe('pass pages and messages use the booking’s own night', () => {
  it('shows the other night’s date and times on its pass page', async () => {
    const other = await createTicket({ orderId: 'TOMORROW', passCount: 1, night: tomorrow });
    const res = await request(app).get(`/api/public/bookings/${other.code}`);
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      gatesOpenAt: at(tomorrow, '18:30').toISOString(),
      startsAt: at(tomorrow, '19:00').toISOString(),
      endsAt: at(tomorrow, '23:59').toISOString(),
      over: false,
    });
    expect(res.body.passes[0].qr).toEqual(expect.any(String));
  });

  it('hides the QR codes once the booking’s own night is over', async () => {
    const yesterday = istDateKey(Date.parse(`${tonight}T12:00:00Z`) - DAY);
    await prisma.event.update({ where: { id: 1 }, data: { gatesOpenAt: at(yesterday, '18:30'), startsAt: at(yesterday, '19:00') } });
    const past = await createTicket({ orderId: 'YESTERDAY', passCount: 1, night: yesterday });
    const res = await request(app).get(`/api/public/bookings/${past.code}`);
    expect(res.body.event.over).toBe(true);
    expect(res.body.passes[0].qr).toBeNull();
  });

  it('puts the booking’s night into the WhatsApp message', async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: 1 } });
    const other = await createTicket({ orderId: 'TOMORROW', passCount: 2, night: tomorrow });
    const message = buildTicketMessage(event, other);
    const weekdayDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(`${tomorrow}T00:00:00Z`))
      .replace(/^(\w+) /, '$1, ');
    expect(message.bodyParams[2]).toBe(weekdayDate);
    expect(message.bodyParams[3]).toBe('19:00');
  });
});

describe('uploading bookings for a multi-night event', () => {
  it('reads the night column (or a date column) and refuses rows without a night', async () => {
    const { agent, csrf } = await signIn(app);
    const [y, m, d] = tomorrow.split('-');
    const csv = [
      'order_id,name,phone,passes,date',
      `N-1,Asha Rao,9876543210,2,${d}/${m}/${y}`,
      'N-2,Ravi Kumar,9876543211,1,',
      'N-3,Meera Shah,9876543212,1,31/12/2030',
    ].join('\n');
    const preview = await agent
      .post('/api/uploads')
      .set('X-CSRF-Token', csrf)
      .attach('file', Buffer.from(csv), 'bookings.csv');
    expect(preview.status).toBe(201);
    const rows = preview.body.rows as { row: number; valid: boolean; errors: string[]; data: { night: string } | null }[];
    expect(rows[0]).toMatchObject({ valid: true, data: { night: tomorrow } });
    expect(rows[1]!.errors[0]).toMatch(/^Row 3: night is missing/);
    expect(rows[2]!.errors[0]).toMatch(/^Row 4: night must be one of the event's nights/);

    const saved = await agent.post(`/api/uploads/${preview.body.upload.id}/confirm`).set('X-CSRF-Token', csrf);
    expect(saved.body).toMatchObject({ created: 1 });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { orderId: 'N-1' } });
    expect(ticket.night?.toISOString().slice(0, 10)).toBe(tomorrow);
  });
});

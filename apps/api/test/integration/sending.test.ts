import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { TICKET_TEMPLATE } from '../../src/config/constants';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db';
import { setMessaging } from '../../src/messaging';
import { MAX_ATTEMPTS, Messaging } from '../../src/messaging/messaging';
import type { MessageSender, OutboundMessage, SendResult } from '../../src/messaging/types';
import { createAdmin, createEvent, createTicket, createTickets, resetDb, signIn } from './helpers';

/** A WhatsApp stand-in whose behaviour each test scripts. By default every message succeeds. */
class FakeSender implements MessageSender {
  readonly name = 'fake';
  sent: OutboundMessage[] = [];
  /** How many times each number has been tried. */
  tries = new Map<string, number>();
  /** Return a failure to simulate one; return undefined to succeed. `attempt` starts at 1. */
  behaviour: (message: OutboundMessage, attempt: number) => SendResult | undefined = () => undefined;

  async send(message: OutboundMessage): Promise<SendResult> {
    const attempt = (this.tries.get(message.to) ?? 0) + 1;
    this.tries.set(message.to, attempt);
    const failure = this.behaviour(message, attempt);
    if (failure) return failure;
    this.sent.push(message);
    return { ok: true, waMessageId: `wamid.${randomUUID()}` };
  }

  reset() {
    this.sent = [];
    this.tries = new Map();
    this.behaviour = () => undefined;
  }
}

const temporary: SendResult = { ok: false, retryable: true, errorCode: '130429', errorText: 'Rate limit hit' };
const permanent: SendResult = { ok: false, retryable: false, errorCode: '131026', errorText: 'Recipient is not on WhatsApp' };

const sender = new FakeSender();
let messaging: Messaging;
let app: Express;
let agent: TestAgent;
let csrf: string;

const post = (path: string, body?: Record<string, unknown>) => agent.post(path).set('X-CSRF-Token', csrf).send(body);
const status = async () => (await agent.get('/api/send/status')).body;
const statusCounts = async () => {
  const rows = await prisma.message.groupBy({ by: ['status'], where: { template: TICKET_TEMPLATE }, _count: true });
  return Object.fromEntries(rows.map((row) => [row.status, row._count]));
};

/** Polls until `check` returns true (the worker runs in the background). */
async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 90_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const waitForNoneQueued = () =>
  waitFor(async () => (await prisma.message.count({ where: { status: 'queued' } })) === 0, 'the queue to empty');

beforeAll(async () => {
  messaging = new Messaging({
    redisUrl: env.REDIS_URL as string,
    prefix: `${env.QUEUE_PREFIX}-${randomUUID().slice(0, 8)}`,
    sender,
    ratePerSecond: env.SEND_RATE_PER_SECOND,
    retryBaseMs: env.SEND_RETRY_BASE_MS,
    runWorker: true,
    concurrency: 5, // small and fixed, so the auto-pause test is predictable
  });
  setMessaging(messaging);
});

beforeEach(async () => {
  await messaging.resume();
  await messaging.reset();
  sender.reset();
  await resetDb();
  await createAdmin();
  await createEvent({ endsAt: new Date(Date.now() + 86_400_000) });
  app = createApp();
  ({ agent, csrf } = await signIn(app));
});

afterAll(async () => {
  await messaging.reset();
  await messaging.close();
  setMessaging(undefined);
  await prisma.$disconnect();
});

describe('POST /api/send', () => {
  it('sends to bookings not yet sent, in batches of a chosen size, and never twice', async () => {
    const first = await createTicket({ orderId: 'ORD-1', name: 'Asha Rao', phone: '+919876543210', passCount: 3 });
    for (const n of [2, 3, 4, 5]) await createTicket({ orderId: `ORD-${n}`, passCount: 1 });
    await createTicket({ orderId: 'ORD-CANCELLED', passCount: 1, status: 'cancelled' });
    expect((await status()).counts.unsent).toBe(5);

    // A first batch of two.
    const batch1 = await post('/api/send', { mode: 'unsent', limit: 2 });
    expect(batch1.status).toBe(202);
    expect(batch1.body).toMatchObject({ template: 'event_ticket_v1', queued: 2 });
    await waitForNoneQueued();
    expect(await statusCounts()).toEqual({ sent: 2 });

    const message = await prisma.message.findFirstOrThrow({ where: { ticketId: first.id } });
    expect(message).toMatchObject({ status: 'sent', attempts: 1, errorCode: null });
    expect(message.waMessageId).toMatch(/^wamid\./);
    // What WhatsApp was asked to send for that booking:
    const outbound = sender.sent.find((m) => m.to === '+919876543210')!;
    expect(outbound.bodyParams.slice(0, 2)).toEqual(['Asha Rao', 'Winter Music Night']);
    expect(outbound.bodyParams[5]).toBe('3');
    expect(outbound.bodyParams[7]).toBe('ORD-1');
    expect(outbound.buttonUrlSuffix).toBe(first.code);

    // The rest: only the three that have not been sent, and not the cancelled booking.
    const batch2 = await post('/api/send', { mode: 'unsent' });
    expect(batch2.body.queued).toBe(3);
    await waitForNoneQueued();
    expect(await statusCounts()).toEqual({ sent: 5 });
    expect(sender.sent).toHaveLength(5);
    expect(new Set(sender.sent.map((m) => m.to)).size).toBe(5);

    // Nothing left to send; nobody is messaged again.
    const batch3 = await post('/api/send', { mode: 'unsent' });
    expect(batch3.body.queued).toBe(0);
    expect(sender.sent).toHaveLength(5);

    const state = await status();
    expect(state).toMatchObject({ configured: true, sender: 'fake', counts: { unsent: 0, sent: 5, failed: 0 } });
    expect(state.queue).toMatchObject({ paused: false, pending: 0, total: 3, sent: 3, failed: 0 });
    // Two audit entries: the third request queued nothing, so there was nothing to record.
    expect(await prisma.auditLog.count({ where: { action: 'send.queue' } })).toBe(2);
  });

  it('retries temporary errors up to three times with backoff, and does not retry permanent ones', async () => {
    const flaky = await createTicket({ orderId: 'FLAKY', phone: '+919000000001', passCount: 1 });
    const down = await createTicket({ orderId: 'DOWN', phone: '+919000000002', passCount: 1 });
    const invalid = await createTicket({ orderId: 'INVALID', phone: '+919000000003', passCount: 1 });
    sender.behaviour = (message, attempt) => {
      if (message.to === '+919000000001') return attempt <= 2 ? temporary : undefined; // works on the 3rd try
      if (message.to === '+919000000002') return temporary; // never recovers
      if (message.to === '+919000000003') return permanent;
      return undefined;
    };

    await post('/api/send', { mode: 'unsent' });
    await waitForNoneQueued();

    const byTicket = async (id: string) => prisma.message.findFirstOrThrow({ where: { ticketId: id } });
    expect(await byTicket(flaky.id)).toMatchObject({ status: 'sent', attempts: 3, errorCode: null });
    expect(await byTicket(down.id)).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS, // first try + 3 retries
      errorCode: '130429',
      errorText: 'Rate limit hit',
    });
    expect(sender.tries.get('+919000000002')).toBe(4);
    expect(await byTicket(invalid.id)).toMatchObject({ status: 'failed', attempts: 1, errorCode: '131026' });
    expect(sender.tries.get('+919000000003')).toBe(1); // not retried

    // "Resend failed" picks up exactly the two failures once the problem is fixed.
    sender.behaviour = () => undefined;
    const resend = await post('/api/send', { mode: 'failed' });
    expect(resend.body.queued).toBe(2);
    await waitForNoneQueued();
    expect(await statusCounts()).toEqual({ sent: 3 });
    expect(sender.tries.get('+919000000001')).toBe(3); // the one that had succeeded was left alone
  });

  it('pauses itself when more than 10% of messages fail, and continues after resume', async () => {
    await createTickets(40);
    sender.behaviour = () => permanent; // e.g. the template was rejected: everything fails

    await post('/api/send', { mode: 'unsent' });
    await waitFor(async () => (await status()).queue.paused === true, 'the automatic pause');

    const paused = await status();
    expect(paused.queue).toMatchObject({ paused: true, pauseReason: 'failure_rate' });
    // It stopped early: most of the 40 are still waiting rather than burned on a broken setup.
    await waitFor(async () => (await prisma.message.count({ where: { status: 'failed' } })) === (await status()).queue.failed, 'active jobs to settle');
    const failedWhilePaused = await prisma.message.count({ where: { status: 'failed' } });
    const stillQueued = await prisma.message.count({ where: { status: 'queued' } });
    expect(failedWhilePaused).toBeGreaterThanOrEqual(10);
    expect(failedWhilePaused).toBeLessThan(30);
    expect(stillQueued).toBe(40 - failedWhilePaused);
    expect(paused.queue.pending).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: 'send.auto_pause' } })).toBe(1);

    // Nothing more goes out while paused.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await prisma.message.count({ where: { status: 'queued' } })).toBe(stillQueued);

    // The organiser fixes the problem and resumes: the waiting messages go out.
    sender.behaviour = () => undefined;
    const resumed = await post('/api/send/resume');
    expect(resumed.body.queue.paused).toBe(false);
    await waitForNoneQueued();
    expect(await statusCounts()).toEqual({ failed: failedWhilePaused, sent: stillQueued });
    expect((await status()).queue).toMatchObject({ paused: false, pauseReason: null, pending: 0 });
  });

  it('can be paused and resumed by the organiser', async () => {
    for (const n of [1, 2, 3]) await createTicket({ orderId: `ORD-${n}`, passCount: 1 });

    const paused = await post('/api/send/pause');
    expect(paused.body.queue).toMatchObject({ paused: true, pauseReason: 'manual' });
    await post('/api/send', { mode: 'unsent' });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await statusCounts()).toEqual({ queued: 3 });
    expect(sender.sent).toHaveLength(0);
    expect((await status()).queue.pending).toBe(3);

    await post('/api/send/resume');
    await waitForNoneQueued();
    expect(await statusCounts()).toEqual({ sent: 3 });
    const actions = (await prisma.auditLog.findMany({ where: { action: { startsWith: 'send.' } } })).map((log) => log.action);
    expect(actions.sort()).toEqual(['send.pause', 'send.queue', 'send.resume']);
  });

  it('sends a reminder only to bookings that still have unused passes', async () => {
    const partly = await createTicket({ orderId: 'PARTLY', phone: '+919000000011', passCount: 3, used: [1] });
    await createTicket({ orderId: 'ALL-IN', phone: '+919000000012', passCount: 2, used: [1, 2] });
    await createTicket({ orderId: 'CANCELLED', phone: '+919000000013', passCount: 1, status: 'cancelled' });

    const res = await post('/api/send', { mode: 'reminder' });
    expect(res.body).toMatchObject({ template: 'event_reminder_v1', queued: 1 });
    await waitForNoneQueued();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ to: '+919000000011', template: 'event_reminder_v1', buttonUrlSuffix: partly.code });
    expect(sender.sent[0]!.bodyParams[6]).toBe('2'); // two passes not yet used
    // A reminder is tracked separately and does not count as "the ticket was sent".
    expect((await status()).counts).toMatchObject({ unsent: 2, sent: 0 });
  });

  it('validates input and needs an admin session with the CSRF token', async () => {
    expect((await post('/api/send', { mode: 'everyone' })).status).toBe(400);
    expect((await post('/api/send', { mode: 'selected' })).status).toBe(400);
    expect((await post('/api/send', { mode: 'unsent', limit: 0 })).status).toBe(400);
    expect((await request(app).post('/api/send').send({ mode: 'unsent' })).status).toBe(401);
    expect((await agent.post('/api/send').send({ mode: 'unsent' })).status).toBe(403);
    expect((await request(app).get('/api/send/status')).status).toBe(401);
  });
});

describe('after Redis loses its data', () => {
  it('puts messages that were waiting back in the queue, and sends each once', async () => {
    const one = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const two = await createTicket({ orderId: 'ORD-2', passCount: 1 });
    // The database says these are waiting, but Redis restarted empty: there are no jobs for them.
    await prisma.message.createMany({
      data: [one, two].map((ticket) => ({ ticketId: ticket.id, template: TICKET_TEMPLATE, status: 'queued' as const })),
    });

    expect(await messaging.recoverStranded()).toBe(2);
    await waitForNoneQueued();
    expect(await statusCounts()).toEqual({ sent: 2 });
    expect(sender.sent).toHaveLength(2);

    // Nothing is waiting any more, so a second check (e.g. the next restart) does nothing.
    expect(await messaging.recoverStranded()).toBe(0);
    expect(sender.sent).toHaveLength(2);
  });

  it('leaves the queue alone while it still has work in it', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    await post('/api/send/pause');
    await post('/api/send', { mode: 'unsent' }); // one real job, held by the pause
    expect(await messaging.recoverStranded()).toBe(0); // must not add a second job for it
    await post('/api/send/resume');
    await waitForNoneQueued();
    expect(sender.tries.get(ticket.phone)).toBe(1);
  });
});

describe('POST /api/tickets/:id/resend', () => {
  it('sends one booking again with a new message ID', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 2 });
    const cancelled = await createTicket({ orderId: 'ORD-2', passCount: 1, status: 'cancelled' });

    expect((await post(`/api/tickets/${ticket.id}/resend`)).status).toBe(202);
    await waitForNoneQueued();
    const before = await prisma.message.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(before.status).toBe('sent');

    expect((await post(`/api/tickets/${ticket.id}/resend`)).body.queued).toBe(1);
    await waitForNoneQueued();
    const after = await prisma.message.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(after).toMatchObject({ id: before.id, status: 'sent', attempts: 2 }); // same row, sent again
    expect(after.waMessageId).not.toBe(before.waMessageId);
    expect(sender.sent).toHaveLength(2);

    expect((await post(`/api/tickets/${cancelled.id}/resend`)).status).toBe(409);
    expect((await post('/api/tickets/3f1c2b9e-8a4d-4c6f-9b1a-2d3e4f5a6b7c/resend')).status).toBe(404);
  });
});

describe('POST /api/send/test', () => {
  it('sends a real booking’s message to the team’s numbers without marking the booking as sent', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', name: 'Asha Rao', passCount: 2 });

    const res = await post('/api/send/test', { phones: ['98765 43210', '+1 415 555 0123'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sender: 'fake',
      orderId: 'ORD-1',
      results: [
        { phone: '98765 43210', ok: true, error: null },
        { phone: '+1 415 555 0123', ok: true, error: null },
      ],
    });
    expect(sender.sent.map((m) => m.to)).toEqual(['+919876543210', '+14155550123']);
    expect(sender.sent[0]).toMatchObject({ template: 'event_ticket_v1', buttonUrlSuffix: ticket.code });
    expect(sender.sent[0]!.bodyParams[0]).toBe('Asha Rao');
    expect(await prisma.message.count()).toBe(0);
    expect((await status()).counts.unsent).toBe(1);

    // A failure is reported per number rather than hidden.
    sender.behaviour = () => permanent;
    const failed = await post('/api/send/test', { phones: ['9876543210'] });
    expect(failed.body.results).toEqual([
      { phone: '9876543210', ok: false, error: 'Recipient is not on WhatsApp (131026)' },
    ]);

    const bad = await post('/api/send/test', { phones: ['12345'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual([{ path: 'phones', message: '12345: phone has 5 digits' }]);
    expect((await post('/api/send/test', { phones: [] })).status).toBe(400);
  });
});

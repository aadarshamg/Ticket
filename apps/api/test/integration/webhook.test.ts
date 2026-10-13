import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { TICKET_TEMPLATE } from '../../src/config/constants';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db';
import { createAdmin, createEvent, createTicket, resetDb } from './helpers';

const app = createApp();
const sign = (body: string, secret = env.WA_APP_SECRET as string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/** A delivery-report payload in the shape Meta sends. */
const report = (...statuses: Record<string, unknown>[]) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses } }] }],
  });

/** Posts a body exactly as given, signed with `signature` (defaults to a correct one). */
const deliver = (body: string, signature: string | null = sign(body)) => {
  const req = request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json');
  if (signature !== null) req.set('X-Hub-Signature-256', signature);
  return req.send(body);
};

let messageId: string;
const stored = () => prisma.message.findUniqueOrThrow({ where: { id: messageId } });

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  await createEvent();
  const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
  const message = await prisma.message.create({
    data: { ticketId: ticket.id, template: TICKET_TEMPLATE, status: 'sent', waMessageId: 'wamid.TEST1', attempts: 1 },
  });
  messageId = message.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/whatsapp/webhook (Meta verification)', () => {
  it('echoes the challenge when the verify token matches', async () => {
    const res = await request(app)
      .get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': env.WA_VERIFY_TOKEN, 'hub.challenge': '1158201444' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('1158201444');
  });

  it('refuses a wrong or missing token', async () => {
    const wrong = await request(app)
      .get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '1158201444' });
    expect(wrong.status).toBe(403);
    expect(wrong.text).not.toContain('1158201444');
    expect((await request(app).get('/api/whatsapp/webhook')).status).toBe(403);
  });
});

describe('POST /api/whatsapp/webhook', () => {
  it('rejects requests whose signature is missing, wrong or for a different body', async () => {
    const body = report({ id: 'wamid.TEST1', status: 'delivered' });

    expect((await deliver(body, null)).status).toBe(401);
    expect((await deliver(body, 'sha256=deadbeef')).status).toBe(401);
    expect((await deliver(body, sign(body, 'not-the-app-secret'))).status).toBe(401);
    // A valid signature for one body does not authorise another.
    const forged = report({ id: 'wamid.TEST1', status: 'read' });
    const res = await deliver(forged, sign(body));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('bad_signature');

    expect((await stored()).status).toBe('sent'); // nothing changed
  });

  it('updates the message status from signed delivery reports', async () => {
    expect((await deliver(report({ id: 'wamid.TEST1', status: 'delivered' }))).status).toBe(200);
    expect((await stored()).status).toBe('delivered');

    await deliver(report({ id: 'wamid.TEST1', status: 'read' }));
    expect((await stored()).status).toBe('read');
  });

  it('never moves a status backwards when reports arrive out of order', async () => {
    await deliver(report({ id: 'wamid.TEST1', status: 'read' }));
    await deliver(report({ id: 'wamid.TEST1', status: 'delivered' }, { id: 'wamid.TEST1', status: 'sent' }));
    expect((await stored()).status).toBe('read');

    // A late "failed" cannot undo a message that was read.
    await deliver(report({ id: 'wamid.TEST1', status: 'failed', errors: [{ code: 131000, title: 'Something went wrong' }] }));
    expect(await stored()).toMatchObject({ status: 'read', errorCode: null });
  });

  it('records why a message failed', async () => {
    const res = await deliver(
      report({
        id: 'wamid.TEST1',
        status: 'failed',
        errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Recipient is not a WhatsApp user' } }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({
      status: 'failed',
      errorCode: '131026',
      errorText: 'Message undeliverable – Recipient is not a WhatsApp user',
    });
  });

  it('accepts reports it has no use for, so Meta does not keep retrying them', async () => {
    expect((await deliver(report({ id: 'wamid.SOMEONE-ELSE', status: 'delivered' }))).status).toBe(200);
    const incomingChat = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '919876543210' }] } }] }] });
    expect((await deliver(incomingChat)).status).toBe(200);
    expect((await deliver('not json', sign('not json'))).status).toBe(400);
    expect((await stored()).status).toBe('sent');
  });
});

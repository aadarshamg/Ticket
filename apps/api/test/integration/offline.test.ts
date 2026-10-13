import { randomUUID, webcrypto } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { hashQr, listMessage } from '../../src/lib/offlineList';
import { signPass } from '../../src/lib/qr';
import { createAdmin, createEvent, createGate, createTicket, gateSignIn, resetDb, signIn } from './helpers';

let app: Express;
let gateA: Awaited<ReturnType<typeof gateSignIn>>;
let gateB: Awaited<ReturnType<typeof gateSignIn>>;

type Ticket = Awaited<ReturnType<typeof createTicket>>;
const passOf = (ticket: Ticket, passNo: number) => ticket.passes.find((pass) => pass.passNo === passNo)!;
const qrOf = (ticket: Ticket, passNo: number) => signPass(passOf(ticket, passNo).id);
const stored = (id: string) => prisma.pass.findUniqueOrThrow({ where: { id } });

/** One admission a phone made while offline. */
const offline = (qr: string, minutesAgo = 5, clientRef: string = randomUUID()) => ({
  clientRef,
  qr,
  scannedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  await createEvent({ endsAt: new Date(Date.now() + 86_400_000) });
  await createGate('Gate A', '111111');
  await createGate('Gate B', '222222');
  app = createApp();
  gateA = await gateSignIn(app, '111111', 'phone-gate-a');
  gateB = await gateSignIn(app, '222222', 'phone-gate-b');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/scan/offline-list', () => {
  it('lists a hash for every currently valid pass, signed so the phone can verify it', async () => {
    const live = await createTicket({ orderId: 'ORD-1', passCount: 3, used: [2] });
    const cancelled = await createTicket({ orderId: 'ORD-2', passCount: 2, status: 'cancelled' });

    const res = await gateA.agent.get('/api/scan/offline-list');
    expect(res.status).toBe(200);
    const { listId, generatedAt, count, hashes, signature, publicKey } = res.body;

    // Only the two passes that can still be used: not the used one, not the cancelled booking.
    expect(count).toBe(2);
    expect([...hashes].sort()).toEqual([hashQr(qrOf(live, 1)), hashQr(qrOf(live, 3))].sort());
    expect(hashes).not.toContain(hashQr(qrOf(live, 2)));
    expect(hashes).not.toContain(hashQr(qrOf(cancelled, 1)));

    // The list never contains a usable QR code, pass ID or any personal detail.
    const body = JSON.stringify(res.body);
    for (const secret of [passOf(live, 1).id, qrOf(live, 1).split('.')[1]!, live.code, live.phone, live.name]) {
      expect(body).not.toContain(secret);
    }

    // Verified exactly as the scanner page does it.
    const key = await webcrypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const verify = (list: string[]) =>
      webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signature, 'base64url'), listMessage(listId, generatedAt, list));
    expect(await verify(hashes)).toBe(true);
    expect(await verify([...hashes, hashQr('a-forged-pass')])).toBe(false);

    expect((await request(app).get('/api/scan/offline-list')).status).toBe(401);
  });
});

describe('POST /api/scan/sync', () => {
  it('records admissions made offline, keeping the time and gate from the phone', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 2 });
    const item = offline(qrOf(ticket, 1), 12);

    const res = await gateA.post('/api/scan/sync', { checkins: [item] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ clientRef: item.clientRef, result: 'ok' }] });

    const pass = await stored(passOf(ticket, 1).id);
    expect(pass).toMatchObject({ status: 'used', usedGate: 'Gate A' });
    expect(pass.usedAt!.toISOString()).toBe(item.scannedAt); // when the person actually entered
    expect(await prisma.checkin.findMany()).toMatchObject([
      { passId: pass.id, gate: 'Gate A', deviceId: 'phone-gate-a', result: 'ok', offline: true, clientRef: item.clientRef },
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'checkin.offline' } })).toBe(1);
  });

  it('is safe to send twice: the same record is never counted as a second entry', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const item = offline(qrOf(ticket, 1));

    const first = await gateA.post('/api/scan/sync', { checkins: [item] });
    const second = await gateA.post('/api/scan/sync', { checkins: [item] }); // e.g. the reply was lost, the phone retries
    expect(first.body.results[0].result).toBe('ok');
    expect(second.body.results[0].result).toBe('ok');
    expect(await prisma.checkin.count()).toBe(1);
    expect((await gateA.agent.get('/api/scan/offline-list')).body.count).toBe(0);
  });

  it('flags a pass admitted offline at two gates, and shows it in the conflicts report', async () => {
    const ticket = await createTicket({ orderId: 'ORD-77', name: 'Asha Rao', passCount: 2 });
    const qr = qrOf(ticket, 1);
    const atA = offline(qr, 30);
    const atB = offline(qr, 20);

    // Both gates were offline with the same list and both let this pass in.
    expect((await gateA.post('/api/scan/sync', { checkins: [atA] })).body.results[0].result).toBe('ok');
    expect((await gateB.post('/api/scan/sync', { checkins: [atB] })).body.results[0].result).toBe('already_used');

    // The pass keeps its first recorded entry.
    expect(await stored(passOf(ticket, 1).id)).toMatchObject({ status: 'used', usedGate: 'Gate A' });

    const admin = await signIn(app);
    const report = await admin.agent.get('/api/checkins/conflicts');
    expect(report.status).toBe(200);
    expect(report.body.conflicts).toEqual([
      {
        id: expect.any(String),
        result: 'already_used',
        gate: 'Gate B',
        deviceId: 'phone-gate-b',
        scannedAt: atB.scannedAt,
        booking: { orderId: 'ORD-77', name: 'Asha Rao', passNo: 1, passCount: 2 },
        recordedEntry: { gate: 'Gate A', at: atA.scannedAt },
      },
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'checkin.offline_conflict' } })).toBe(1);

    // The report is for the organiser, not for volunteers.
    expect((await gateA.agent.get('/api/checkins/conflicts')).status).toBe(401);
    expect((await request(app).get('/api/checkins/conflicts')).status).toBe(401);
  });

  it('flags offline admissions of a pass used online, a cancelled booking and a fake code', async () => {
    const usedOnline = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const cancelled = await createTicket({ orderId: 'ORD-2', passCount: 1, status: 'cancelled' });
    const fine = await createTicket({ orderId: 'ORD-3', passCount: 1 });
    // Gate A, online, admits ORD-1 while Gate B is offline with an older list.
    expect((await gateA.post('/api/scan', { qr: qrOf(usedOnline, 1) })).body.result).toBe('ok');

    const items = [
      offline(qrOf(usedOnline, 1), 1),
      offline(qrOf(cancelled, 1), 2),
      offline(`${randomUUID()}.AAAAAAAAAAAAAAAAAAAAAA`, 3), // not a pass this server issued
      offline(qrOf(fine, 1), 4),
    ];
    const res = await gateB.post('/api/scan/sync', { checkins: items });
    expect(res.body.results.map((r: { result: string }) => r.result)).toEqual(['already_used', 'cancelled', 'invalid', 'ok']);

    const admin = await signIn(app);
    const { conflicts } = (await admin.agent.get('/api/checkins/conflicts')).body;
    expect(conflicts.map((c: { result: string }) => c.result).sort()).toEqual(['already_used', 'cancelled', 'invalid']);
    expect(conflicts.find((c: { result: string }) => c.result === 'invalid').booking).toBeNull();
    expect(conflicts.find((c: { result: string }) => c.result === 'already_used')).toMatchObject({
      gate: 'Gate B',
      booking: { orderId: 'ORD-1' },
      recordedEntry: { gate: 'Gate A' },
    });
    // The cancelled pass stays cancelled; the good one is now used.
    expect((await stored(passOf(cancelled, 1).id)).status).toBe('cancelled');
    expect((await stored(passOf(fine, 1).id)).status).toBe('used');
  });

  it('does not report a conflict when an online scan succeeded but its answer never reached the phone', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const qr = qrOf(ticket, 1);
    const clientRef = randomUUID();

    // The phone scans online; the server admits, but (say) the reply times out...
    expect((await gateA.post('/api/scan', { qr, clientRef })).body.result).toBe('ok');
    // ...so the phone fell back to its offline list, admitted the same person, and now syncs that record.
    const res = await gateA.post('/api/scan/sync', { checkins: [offline(qr, 0, clientRef)] });
    expect(res.body.results[0].result).toBe('ok');

    expect(await prisma.checkin.count()).toBe(1);
    const admin = await signIn(app);
    expect((await admin.agent.get('/api/checkins/conflicts')).body.conflicts).toEqual([]);
  });

  it('never records an entry in the future, validates input and needs a gate session', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 1 });
    const wrongClock = { ...offline(qrOf(ticket, 1)), scannedAt: new Date(Date.now() + 3 * 3_600_000).toISOString() };
    expect((await gateA.post('/api/scan/sync', { checkins: [wrongClock] })).body.results[0].result).toBe('ok');
    const usedAt = (await stored(passOf(ticket, 1).id)).usedAt!;
    expect(usedAt.getTime()).toBeLessThanOrEqual(Date.now());

    expect((await gateA.post('/api/scan/sync', { checkins: [] })).status).toBe(400);
    expect((await gateA.post('/api/scan/sync', { checkins: [{ clientRef: 'nope', qr: 'x', scannedAt: 'yesterday' }] })).status).toBe(400);
    expect((await gateA.agent.post('/api/scan/sync').send({ checkins: [offline('x')] })).status).toBe(403); // no CSRF token
    expect((await request(app).post('/api/scan/sync').send({ checkins: [offline('x')] })).status).toBe(401);
  });
});

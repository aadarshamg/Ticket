import type { Express } from 'express';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { createAdmin, createEvent, createTicket, resetDb, signIn } from './helpers';

let app: Express;
let agent: TestAgent;
let csrf: string;

const HEADER = ['order_id', 'name', 'phone', 'passes', 'amount', 'category', 'email'];

function xlsx(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Bookings');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const upload = (file: Buffer, fileName = 'bookings.xlsx') =>
  agent.post('/api/uploads').set('X-CSRF-Token', csrf).attach('file', file, fileName);

const confirm = (id: string) => agent.post(`/api/uploads/${id}/confirm`).set('X-CSRF-Token', csrf);

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

describe('upload → preview → confirm', () => {
  it('previews every row with exact reasons, saves nothing, then confirm creates bookings and passes', async () => {
    const preview = await upload(
      xlsx([
        HEADER,
        ['ORD-1', 'Asha Rao', 9876543210, 4, 3196, 'General', 'asha@example.com'],
        ['ORD-2', 'Dev Shah', '+91 98765-43211', 1, null, null, null],
        ['ORD-3', 'Bad Phone', '987654321', 2, null, null, null],
        ['ORD-4', 'Too Many', '9876543213', 11, null, null, null],
        ['ORD-5', 'Meera Nair', '09876543214', 2, '1,598', 'VIP', 'not-an-email'],
      ]),
    );

    expect(preview.status).toBe(201);
    expect(preview.body.upload).toMatchObject({ rowCount: 5, validCount: 2, errorCount: 3, status: 'pending' });
    expect(preview.body.summary).toEqual({ create: 2, update: 0, unchanged: 0, invalid: 3 });
    const errors = preview.body.rows.flatMap((row: { errors: string[] }) => row.errors);
    expect(errors).toEqual([
      'Row 4: phone has 9 digits',
      'Row 5: passes must be between 1 and 10',
      'Row 6: email is not valid',
    ]);
    expect(preview.body.rows[0]).toMatchObject({
      row: 2,
      valid: true,
      action: 'create',
      data: { orderId: 'ORD-1', phone: '+919876543210', passCount: 4, amount: '3196.00' },
    });

    // Nothing is saved until confirm.
    expect(await prisma.ticket.count()).toBe(0);
    expect(await prisma.pass.count()).toBe(0);

    const saved = await confirm(preview.body.upload.id);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
      skipped: [],
      passesCreated: 5,
      passesRemoved: 0,
    });

    const tickets = await prisma.ticket.findMany({ orderBy: { orderId: 'asc' }, include: { passes: true } });
    expect(tickets.map((ticket) => ticket.orderId)).toEqual(['ORD-1', 'ORD-2']); // invalid rows not saved
    const [first, second] = tickets;
    expect(first).toMatchObject({
      name: 'Asha Rao',
      phone: '+919876543210',
      email: 'asha@example.com',
      passCount: 4,
      category: 'General',
      status: 'active',
      uploadId: preview.body.upload.id,
    });
    expect(first!.amount?.toFixed(2)).toBe('3196.00');
    expect(first!.code).toMatch(/^[2-9A-HJ-NP-Z]{12}$/);
    expect(first!.passes.map((pass) => pass.passNo).sort()).toEqual([1, 2, 3, 4]);
    expect(first!.passes.every((pass) => pass.status === 'valid' && /^[2-9A-HJ-NP-Z]{12}$/.test(pass.code))).toBe(true);
    expect(second).toMatchObject({ phone: '+919876543211', passCount: 1, amount: null, email: null });

    const codes = tickets.flatMap((ticket) => [ticket.code, ...ticket.passes.map((pass) => pass.code)]);
    expect(new Set(codes).size).toBe(7);

    // The preview (which holds personal data) is cleared, and the upload cannot be saved twice.
    const stored = await prisma.upload.findUniqueOrThrow({ where: { id: preview.body.upload.id } });
    expect(stored).toMatchObject({ status: 'confirmed', previewRows: null });
    expect(stored.confirmedAt).not.toBeNull();
    const again = await confirm(preview.body.upload.id);
    expect(again.status).toBe(409);
    expect(await prisma.ticket.count()).toBe(2);

    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'Upload' } })).map((log) => log.action);
    expect(actions.sort()).toEqual(['upload.confirm', 'upload.preview']);
  });

  it('re-uploading an order ID updates that booking and keeps its code and existing passes', async () => {
    const first = await upload(
      xlsx([
        HEADER,
        ['ORD-1', 'Asha Rao', '9876543210', 2, 1598, 'General', 'asha@example.com'],
        ['ORD-2', 'Dev Shah', '9876543211', 1, 799, 'General', null],
      ]),
    );
    await confirm(first.body.upload.id);
    const before = await prisma.ticket.findUniqueOrThrow({ where: { orderId: 'ORD-1' }, include: { passes: true } });

    // Second file: ORD-1 changes name, phone and passes 2 → 4; ORD-2 is the same; ORD-3 is new.
    // It has no amount/category/email columns, so those stored values must be kept.
    const second = await upload(
      xlsx([
        ['order_id', 'name', 'phone', 'passes'],
        ['ORD-1', 'Asha R. Rao', '9876500000', 4],
        ['ORD-2', 'Dev Shah', '9876543211', 1],
        ['ORD-3', 'Meera Nair', '9876543212', 3],
      ]),
    );
    expect(second.body.summary).toEqual({ create: 1, update: 1, unchanged: 1, invalid: 0 });
    expect(second.body.rows[0]).toMatchObject({ action: 'update', changes: ['name', 'phone', 'passes 2 → 4'] });
    expect(second.body.rows[1]).toMatchObject({ action: 'unchanged', changes: [] });

    const saved = await confirm(second.body.upload.id);
    expect(saved.body).toMatchObject({ created: 1, updated: 1, unchanged: 1, passesCreated: 5, passesRemoved: 0 });

    const after = await prisma.ticket.findUniqueOrThrow({ where: { orderId: 'ORD-1' }, include: { passes: true } });
    expect(after).toMatchObject({
      id: before.id,
      code: before.code,
      name: 'Asha R. Rao',
      phone: '+919876500000',
      passCount: 4,
      email: 'asha@example.com',
      category: 'General',
      uploadId: second.body.upload.id,
    });
    expect(after.amount?.toFixed(2)).toBe('1598.00');
    expect(after.passes.map((pass) => pass.passNo).sort()).toEqual([1, 2, 3, 4]);
    // The two original passes (and their QR codes) are untouched.
    for (const pass of before.passes) {
      expect(after.passes.find((p) => p.id === pass.id)).toMatchObject({ code: pass.code, passNo: pass.passNo });
    }
    expect(await prisma.ticket.count()).toBe(3);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ticket.update', entityId: before.id } });
    expect(log.meta).toMatchObject({ via: 'upload', changes: ['name', 'phone', 'passes 2 → 4'] });
    expect(JSON.stringify(log.meta)).not.toContain('9876500000');
  });

  it('reducing passes removes only unused ones and refuses to delete a used pass', async () => {
    // ORD-1: 4 passes, pass 4 already used. ORD-2: 3 passes, all used.
    const one = await createTicket({ orderId: 'ORD-1', passCount: 4, used: [4] });
    const two = await createTicket({ orderId: 'ORD-2', passCount: 3, used: [1, 2, 3] });
    const usedPass = one.passes.find((pass) => pass.passNo === 4)!;

    const preview = await upload(
      xlsx([
        ['order_id', 'name', 'phone', 'passes'],
        ['ORD-1', one.name, one.phone, 2],
        ['ORD-2', two.name, two.phone, 2],
      ]),
    );
    expect(preview.body.summary).toEqual({ create: 0, update: 1, unchanged: 0, invalid: 1 });
    expect(preview.body.rows[1].errors).toEqual(['Row 3: cannot reduce to 2 passes: 3 already used']);

    const saved = await confirm(preview.body.upload.id);
    expect(saved.body).toMatchObject({ updated: 1, passesRemoved: 2, passesCreated: 0, skipped: [] });

    const after = await prisma.ticket.findUniqueOrThrow({
      where: { orderId: 'ORD-1' },
      include: { passes: { orderBy: { passNo: 'asc' } } },
    });
    expect(after.passCount).toBe(2);
    expect(after.passes.map((pass) => [pass.passNo, pass.status])).toEqual([
      [1, 'valid'],
      [2, 'used'],
    ]);
    expect(after.passes[1]).toMatchObject({ id: usedPass.id, code: usedPass.code }); // the used pass survived, renumbered

    const untouched = await prisma.ticket.findUniqueOrThrow({ where: { orderId: 'ORD-2' }, include: { passes: true } });
    expect(untouched.passCount).toBe(3);
    expect(untouched.passes).toHaveLength(3);
  });

  it('re-checks rows at confirm time: a pass used after the preview blocks the reduction', async () => {
    const ticket = await createTicket({ orderId: 'ORD-1', passCount: 3 });
    const preview = await upload(
      xlsx([
        ['order_id', 'name', 'phone', 'passes'],
        ['ORD-1', ticket.name, ticket.phone, 1],
      ]),
    );
    expect(preview.body.summary).toMatchObject({ update: 1, invalid: 0 });

    // Two people enter between preview and confirm.
    await prisma.pass.updateMany({
      where: { ticketId: ticket.id, passNo: { in: [1, 2] } },
      data: { status: 'used', usedAt: new Date(), usedGate: 'Gate A' },
    });

    const saved = await confirm(preview.body.upload.id);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      updated: 0,
      skipped: [{ row: 2, orderId: 'ORD-1', reason: 'cannot reduce to 1 pass: 2 already used' }],
    });
    expect(await prisma.pass.count({ where: { ticketId: ticket.id } })).toBe(3);
  });

  it('handles a full-size event: 3,000 bookings created, then every one updated', async () => {
    const header = ['order_id', 'name', 'phone', 'passes', 'amount'];
    const rows = Array.from({ length: 3000 }, (_, i) => [
      `BULK-${i + 1}`,
      `Guest ${i + 1}`,
      `98${10000000 + i}`,
      (i % 4) + 1, // 750 bookings each of 1, 2, 3 and 4 passes = 7,500 passes
      500,
    ]);

    const first = await upload(xlsx([header, ...rows]));
    expect(first.body.summary).toEqual({ create: 3000, update: 0, unchanged: 0, invalid: 0 });
    let started = Date.now();
    const created = await confirm(first.body.upload.id);
    const createMs = Date.now() - started;
    expect(created.body).toMatchObject({ created: 3000, passesCreated: 7500, skipped: [] });
    expect(await prisma.ticket.count()).toBe(3000);
    expect(await prisma.pass.count()).toBe(7500);

    // Every amount changes, and the first 100 bookings go up to 5 passes (250 + 250 more passes).
    const second = await upload(xlsx([header, ...rows.map((row, i) => [row[0], row[1], row[2], i < 100 ? 5 : row[3], 600])]));
    expect(second.body.summary).toEqual({ create: 0, update: 3000, unchanged: 0, invalid: 0 });
    started = Date.now();
    const updated = await confirm(second.body.upload.id);
    const updateMs = Date.now() - started;
    expect(updated.body).toMatchObject({ created: 0, updated: 3000, unchanged: 0, passesCreated: 250, passesRemoved: 0 });

    expect(await prisma.ticket.count({ where: { amount: 600 } })).toBe(3000);
    expect(await prisma.pass.count()).toBe(7750);
    const sample = await prisma.ticket.findUniqueOrThrow({ where: { orderId: 'BULK-1' }, include: { passes: true } });
    expect(sample.passCount).toBe(5);
    expect(sample.passes.map((pass) => pass.passNo).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await prisma.auditLog.count({ where: { action: 'ticket.update' } })).toBe(3000);

    console.info(`3,000-booking confirm: create ${createMs} ms, update ${updateMs} ms`);
    // Saving must not scale with one query per row.
    expect(createMs).toBeLessThan(60_000);
    expect(updateMs).toBeLessThan(60_000);
  });

  it('accepts CSV, and rejects files it cannot use with a clear message', async () => {
    const csv = Buffer.from('Order ID,Name,Phone,Passes\nC1,आशा राव,+14155550123,2\n', 'utf8');
    const ok = await upload(csv, 'bookings.csv');
    expect(ok.status).toBe(201);
    expect(ok.body.rows[0]).toMatchObject({ valid: true, data: { name: 'आशा राव', phone: '+14155550123' } });

    const missing = await upload(xlsx([['order_id', 'name'], ['A', 'B']]));
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/^Missing required columns: phone, passes/);

    const wrongType = await upload(Buffer.from('hello'), 'notes.txt');
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe('invalid_file');

    const noFile = await agent.post('/api/uploads').set('X-CSRF-Token', csrf);
    expect(noFile.status).toBe(400);

    const tooBig = await upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'big.csv');
    expect(tooBig.status).toBe(413);

    expect((await confirm('3f1c2b9e-8a4d-4c6f-9b1a-2d3e4f5a6b7c')).status).toBe(404);
    expect((await confirm('not-a-uuid')).status).toBe(404);
  });

  it('needs an admin session and the CSRF token', async () => {
    const file = xlsx([HEADER, ['ORD-1', 'Asha Rao', '9876543210', 1, null, null, null]]);
    expect((await request(app).post('/api/uploads').attach('file', file, 'b.xlsx')).status).toBe(401);
    expect((await agent.post('/api/uploads').attach('file', file, 'b.xlsx')).status).toBe(403);
    expect(await prisma.upload.count()).toBe(0);
  });
});

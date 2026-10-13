import bcrypt from 'bcrypt';
import type { Express } from 'express';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { createAdmin, resetDb, signIn, validEventBody } from './helpers';

let app: Express;
let agent: TestAgent;
let csrf: string;

const put = (body: Record<string, unknown>) => agent.put('/api/event').set('X-CSRF-Token', csrf).send(body);

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  app = createApp();
  ({ agent, csrf } = await signIn(app));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('event settings', () => {
  it('returns null before the event is set up', async () => {
    const res = await agent.get('/api/event');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ event: null, gates: [] });
  });

  it('creates then updates the single settings row, storing times as instants', async () => {
    const created = await put(validEventBody());
    expect(created.status).toBe(200);
    expect(created.body.event).toMatchObject({
      id: 1,
      name: 'Winter Music Night',
      brandColour: '#4f46e5',
      logoUrl: null,
      maxPassesPerBooking: 10,
      startsAt: '2026-11-14T12:30:00.000Z', // 18:00 IST
    });

    const updated = await put(validEventBody({ name: 'Renamed Night', maxPassesPerBooking: 6 }));
    expect(updated.status).toBe(200);
    expect(await prisma.event.count()).toBe(1);

    const read = await agent.get('/api/event');
    expect(read.body.event).toMatchObject({ name: 'Renamed Night', maxPassesPerBooking: 6 });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'Event' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((log) => log.action)).toEqual(['event.create', 'event.update']);
    expect(logs[1]?.meta).toEqual({ changed: ['name', 'maxPassesPerBooking'] });
  });

  it('rejects invalid settings with a message per field and saves nothing', async () => {
    const res = await put(
      validEventBody({
        name: '   ',
        endsAt: '2026-11-14T17:00:00+05:30',
        gatesOpenAt: '2026-11-14T19:00:00+05:30',
        brandColour: 'purple',
        maxPassesPerBooking: 0,
      }),
    );
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['name', 'endsAt', 'gatesOpenAt', 'brandColour', 'maxPassesPerBooking']),
    );
    expect(await prisma.event.count()).toBe(0);
  });
});

describe('gates', () => {
  const gates = [
    { name: 'Gate A', pin: '1234' },
    { name: 'Gate B', pin: '5678' },
  ];

  it('creates gates with hashed PINs and never returns the PIN or its hash', async () => {
    const res = await put(validEventBody({ gates }));
    expect(res.status).toBe(200);
    expect(res.body.gates.map((g: { name: string }) => g.name)).toEqual(['Gate A', 'Gate B']);
    expect(JSON.stringify(res.body)).not.toMatch(/pin/i);
    expect(JSON.stringify(res.body)).not.toContain('1234');

    const stored = await prisma.gate.findUniqueOrThrow({ where: { name: 'Gate A' } });
    expect(stored.pinHash).not.toContain('1234');
    expect(await bcrypt.compare('1234', stored.pinHash)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'gate.create' } })).toBe(2);
  });

  it('leaves gates untouched when the gate list is not sent', async () => {
    await put(validEventBody({ gates }));
    const res = await put(validEventBody({ name: 'Another name' }));
    expect(res.body.gates).toHaveLength(2);
  });

  it('renames, deactivates, resets a PIN and deletes gates left out of the list', async () => {
    const first = await put(validEventBody({ gates }));
    const gateA = first.body.gates.find((g: { name: string }) => g.name === 'Gate A');

    const res = await put(
      validEventBody({
        gates: [
          { id: gateA.id, name: 'Main Gate', active: false, pin: '9999' },
          { name: 'Gate C', pin: '4321' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.gates.map((g: { name: string }) => g.name)).toEqual(['Gate C', 'Main Gate']);

    const main = await prisma.gate.findUniqueOrThrow({ where: { id: gateA.id } });
    expect(main.active).toBe(false);
    expect(await bcrypt.compare('9999', main.pinHash)).toBe(true);
    expect(await bcrypt.compare('1234', main.pinHash)).toBe(false);
    expect(await prisma.gate.findUnique({ where: { name: 'Gate B' } })).toBeNull();

    const update = await prisma.auditLog.findFirstOrThrow({ where: { action: 'gate.update' } });
    expect(update.meta).toEqual({ name: 'Main Gate', active: false, pinReset: true });
    expect(await prisma.auditLog.count({ where: { action: 'gate.delete' } })).toBe(1);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('9999');
  });

  it('keeps the existing PIN when a gate is saved without one', async () => {
    const first = await put(validEventBody({ gates }));
    const [a, b] = first.body.gates;
    const before = await prisma.gate.findUniqueOrThrow({ where: { id: a.id } });

    const res = await put(validEventBody({ gates: [{ id: a.id, name: a.name }, { id: b.id, name: b.name }] }));
    expect(res.status).toBe(200);
    const after = await prisma.gate.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.pinHash).toBe(before.pinHash);
    expect(await prisma.auditLog.count({ where: { action: 'gate.update' } })).toBe(0);
  });

  it('refuses a PIN that another gate already uses', async () => {
    const first = await put(validEventBody({ gates }));
    const [a, b] = first.body.gates;

    const res = await put(
      validEventBody({ gates: [{ id: a.id, name: a.name }, { id: b.id, name: b.name, pin: '1234' }] }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details[0]).toMatchObject({ path: 'gates.1.pin' });

    const stored = await prisma.gate.findUniqueOrThrow({ where: { id: b.id } });
    expect(await bcrypt.compare('5678', stored.pinHash)).toBe(true);
  });

  it('refuses a new gate without a PIN, duplicate PINs and duplicate names', async () => {
    const res = await put(
      validEventBody({
        gates: [
          { name: 'Gate A', pin: '1234' },
          { name: 'gate a', pin: '1234' },
          { name: 'Gate C' },
          { name: 'Gate D', pin: '12' },
        ],
      }),
    );
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['gates.1.name', 'gates.1.pin', 'gates.2.pin', 'gates.3.pin']));
    expect(await prisma.gate.count()).toBe(0);
  });
});

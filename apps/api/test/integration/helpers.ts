import { randomUUID } from 'node:crypto';
import type { Prisma, TicketStatus } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db';
import { generateCode } from '../../src/lib/codes';
import { hashPassword } from '../../src/lib/passwords';

const TABLES = ['AuditLog', 'Checkin', 'Message', 'Pass', 'Ticket', 'Upload', 'AdminUser', 'Gate', 'Event'];

export const ADMIN_EMAIL = 'admin@test.local';
export const ADMIN_PASSWORD = 'correct-horse-battery-staple';

/** Empties every table in the test schema. */
export async function resetDb(): Promise<void> {
  if (!env.DB_SCHEMA.endsWith('_test')) {
    throw new Error(`Refusing to truncate schema "${env.DB_SCHEMA}": not a test schema`);
  }
  const tables = TABLES.map((table) => `"${env.DB_SCHEMA}"."${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

let cachedHash: string | undefined;

export async function createAdmin(email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  const passwordHash =
    password === ADMIN_PASSWORD ? (cachedHash ??= await hashPassword(password)) : await hashPassword(password);
  return prisma.adminUser.create({ data: { email, name: 'Test Admin', passwordHash } });
}

/** Signs in and returns a cookie-keeping agent plus the CSRF token for write requests. */
export async function signIn(app: Express, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Sign-in failed in test helper: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { agent, csrf: res.body.csrfToken as string };
}

export async function createEvent(overrides: Partial<Prisma.EventCreateInput> = {}) {
  return prisma.event.create({
    data: {
      id: 1,
      name: 'Winter Music Night',
      organiserName: 'Sangam Events',
      venue: 'Palace Grounds',
      city: 'Bengaluru',
      startsAt: new Date('2026-11-14T18:00:00+05:30'),
      gatesOpenAt: new Date('2026-11-14T16:30:00+05:30'),
      endsAt: new Date('2026-11-14T23:00:00+05:30'),
      maxPassesPerBooking: 10,
      ...overrides,
    },
  });
}

interface TicketOptions {
  orderId: string;
  passCount: number;
  name?: string;
  phone?: string;
  email?: string | null;
  status?: TicketStatus;
  /** Pass numbers that have already been used at the gate. */
  used?: number[];
}

let ticketSeq = 0;

/** Creates a booking with its passes directly in the database (an admin must exist). */
export async function createTicket(options: TicketOptions) {
  const admin = await prisma.adminUser.findFirstOrThrow();
  const upload =
    (await prisma.upload.findFirst({ where: { fileName: 'test-fixture' } })) ??
    (await prisma.upload.create({
      data: {
        fileName: 'test-fixture',
        uploadedById: admin.id,
        rowCount: 0,
        validCount: 0,
        errorCount: 0,
        status: 'confirmed',
      },
    }));
  const status = options.status ?? 'active';
  const used = new Set(options.used ?? []);
  return prisma.ticket.create({
    data: {
      orderId: options.orderId,
      code: generateCode(),
      name: options.name ?? `Guest ${options.orderId}`,
      phone: options.phone ?? `+9198${String(10000000 + ticketSeq++).padStart(8, '0')}`,
      email: options.email ?? null,
      passCount: options.passCount,
      status,
      uploadId: upload.id,
      passes: {
        create: Array.from({ length: options.passCount }, (_, index) => {
          const isUsed = used.has(index + 1);
          return {
            passNo: index + 1,
            code: generateCode(),
            status: isUsed ? ('used' as const) : status === 'cancelled' ? ('cancelled' as const) : ('valid' as const),
            usedAt: isUsed ? new Date() : null,
            usedGate: isUsed ? 'Gate A' : null,
          };
        }),
      },
    },
    include: { passes: true },
  });
}

/** Creates `count` single-pass bookings in three statements (for tests that need many). */
export async function createTickets(count: number, prefix = 'BULK') {
  const anchor = await createTicket({ orderId: `${prefix}-0`, passCount: 1 });
  const tickets = Array.from({ length: count - 1 }, (_, index) => ({
    id: randomUUID(),
    orderId: `${prefix}-${index + 1}`,
    code: generateCode(),
    name: `Guest ${prefix}-${index + 1}`,
    phone: `+9197${String(10000000 + index).padStart(8, '0')}`,
    passCount: 1,
    uploadId: anchor.uploadId,
  }));
  await prisma.ticket.createMany({ data: tickets });
  await prisma.pass.createMany({
    data: tickets.map((ticket) => ({ ticketId: ticket.id, passNo: 1, code: generateCode() })),
  });
}

export function validEventBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Winter Music Night',
    organiserName: 'Sangam Events',
    venue: 'Palace Grounds',
    city: 'Bengaluru',
    startsAt: '2026-11-14T18:00:00+05:30',
    gatesOpenAt: '2026-11-14T16:30:00+05:30',
    endsAt: '2026-11-14T23:00:00+05:30',
    logoUrl: '',
    brandColour: '#4F46E5',
    helplineNumber: '+91 80 5550 0100',
    termsText: 'Each pass admits one person, once.',
    maxPassesPerBooking: 10,
    ...overrides,
  };
}

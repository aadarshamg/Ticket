import type { Express } from 'express';
import request from 'supertest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db';
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

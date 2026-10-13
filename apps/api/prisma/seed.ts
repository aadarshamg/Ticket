/**
 * Demo data: an event, two gates, an admin login and 3,000 fake bookings.
 *
 *   npm run seed                  3,000 bookings
 *   npm run seed -- --count=200   a smaller set
 *
 * Safe to re-run: it only replaces bookings whose order ID starts with DEMO-,
 * and never overwrites existing event settings, gates or admin passwords.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { env } from '../src/config/env';
import { prisma } from '../src/db';
import { generateUniqueCodes } from '../src/lib/codes';
import { hashPassword, hashPin } from '../src/lib/passwords';

const DEMO_PREFIX = 'DEMO-';
const DEMO_FILE = 'demo-seed.xlsx';
const CHUNK = 1000;

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Akash', 'Ananya', 'Arjun', 'Bhavna', 'Chirag', 'Deepika', 'Dev', 'Divya',
  'Farhan', 'Gauri', 'Harsh', 'Ishaan', 'Jaya', 'Karan', 'Kavya', 'Lakshmi', 'Manish', 'Meera',
  'Nikhil', 'Neha', 'Omkar', 'Pooja', 'Rahul', 'Riya', 'Rohan', 'Sana', 'Sanjay', 'Shreya',
  'Siddharth', 'Sneha', 'Tanvi', 'Uday', 'Varun', 'Vidya', 'Yash', 'Zoya', 'Imran', 'Priya',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Khan', 'Singh', 'Das',
  'Mehta', 'Joshi', 'Kulkarni', 'Chopra', 'Banerjee', 'Pillai', 'Shetty', 'Mishra', 'Yadav', 'Bose',
];
const CATEGORIES = [
  { name: 'General', price: 799, weight: 70 },
  { name: 'Student', price: 499, weight: 20 },
  { name: 'VIP', price: 1999, weight: 10 },
];

const pick = <T>(items: readonly T[]): T => items[randomInt(items.length)] as T;

function pickCategory() {
  let roll = randomInt(100);
  for (const category of CATEGORIES) {
    if (roll < category.weight) return category;
    roll -= category.weight;
  }
  return CATEGORIES[0]!;
}

/** Most bookings are for 1–4 people; a few are larger groups. */
function pickPassCount(max: number): number {
  const count = randomInt(100) < 85 ? randomInt(1, 5) : randomInt(5, 9);
  return Math.min(count, max);
}

function fakePhone(): string {
  return `+91${randomInt(6, 10)}${String(randomInt(1_000_000_000)).padStart(9, '0')}`;
}

function readCount(): number {
  const arg = process.argv.find((value) => value.startsWith('--count='));
  const count = arg ? Number(arg.split('=')[1]) : 3000;
  if (!Number.isInteger(count) || count < 1 || count > 20000) {
    throw new Error('--count must be a whole number between 1 and 20000');
  }
  return count;
}

async function ensureEvent() {
  const existing = await prisma.event.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  console.log('Creating demo event settings');
  return prisma.event.create({
    data: {
      id: 1,
      name: 'Winter Music Night 2026',
      organiserName: 'Sangam Events',
      venue: 'Palace Grounds',
      city: 'Bengaluru',
      startsAt: new Date('2026-11-14T18:00:00+05:30'),
      gatesOpenAt: new Date('2026-11-14T16:30:00+05:30'),
      endsAt: new Date('2026-11-14T23:00:00+05:30'),
      brandColour: '#4f46e5',
      helplineNumber: '+91 80 5550 0100',
      termsText:
        'Each pass admits one person, once. Passes are non-refundable and non-transferable after entry. ' +
        'Carry a valid photo ID. The organiser may refuse entry.',
      maxPassesPerBooking: 10,
    },
  });
}

async function ensureGates() {
  if ((await prisma.gate.count()) > 0) return;
  for (const name of ['Gate A', 'Gate B']) {
    const pin = String(randomInt(100_000, 1_000_000));
    await prisma.gate.create({ data: { name, pinHash: await hashPin(pin) } });
    console.log(`Created ${name} with PIN ${pin} (shown only now; reset it in Admin > Settings)`);
  }
}

async function ensureAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return existing;
  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
  const admin = await prisma.adminUser.create({
    data: { email, name: 'Demo Admin', passwordHash: await hashPassword(password) },
  });
  console.log(`Created admin login: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`Generated password: ${password} (shown only now)`);
  }
  return admin;
}

async function main() {
  if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed demo data in production. Pass --force to override.');
  }
  const count = readCount();

  const event = await ensureEvent();
  await ensureGates();
  const admin = await ensureAdmin();

  const removed = await prisma.ticket.deleteMany({ where: { orderId: { startsWith: DEMO_PREFIX } } });
  await prisma.upload.deleteMany({ where: { fileName: DEMO_FILE, tickets: { none: {} } } });
  if (removed.count > 0) console.log(`Removed ${removed.count} previous demo bookings`);

  const upload = await prisma.upload.create({
    data: {
      fileName: DEMO_FILE,
      uploadedById: admin.id,
      rowCount: count,
      validCount: count,
      errorCount: 0,
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });

  const tickets: Prisma.TicketCreateManyInput[] = [];
  const passes: Prisma.PassCreateManyInput[] = [];
  const ticketCodes = generateUniqueCodes(count);

  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const category = pickCategory();
    const passCount = pickPassCount(event.maxPassesPerBooking);
    tickets.push({
      id,
      orderId: `${DEMO_PREFIX}${String(i + 1).padStart(5, '0')}`,
      code: ticketCodes[i]!,
      name: `${first} ${last}`,
      phone: fakePhone(),
      email: randomInt(100) < 60 ? `${first}.${last}${i + 1}@example.com`.toLowerCase() : null,
      passCount,
      amount: passCount * category.price,
      category: category.name,
      uploadId: upload.id,
    });
    for (let passNo = 1; passNo <= passCount; passNo++) {
      passes.push({ ticketId: id, passNo, code: '' });
    }
  }

  const passCodes = generateUniqueCodes(passes.length, new Set(ticketCodes));
  passes.forEach((pass, index) => {
    pass.code = passCodes[index]!;
  });

  for (let i = 0; i < tickets.length; i += CHUNK) {
    await prisma.ticket.createMany({ data: tickets.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < passes.length; i += CHUNK) {
    await prisma.pass.createMany({ data: passes.slice(i, i + CHUNK) });
  }

  await prisma.auditLog.create({
    data: {
      actorType: 'system',
      actorLabel: 'seed script',
      action: 'seed.demo_data',
      entityType: 'Upload',
      entityId: upload.id,
      meta: { bookings: tickets.length, passes: passes.length },
    },
  });

  console.log(`Seeded ${tickets.length} bookings with ${passes.length} passes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

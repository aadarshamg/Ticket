import type { CheckinResult, PassStatus, Prisma, TicketStatus } from '@prisma/client';
import { prisma, TX_OPTIONS } from '../db';
import { verifyQr } from '../lib/qr';
import type { GateSession } from '../lib/session';
import { table } from '../lib/sql';
import { HttpError } from '../middleware/errors';

/**
 * What the scanner shows. Volunteers get the name, category and pass counts only:
 * never a phone number, email address or order ID.
 */
export interface ScanOutcome {
  result: CheckinResult;
  booking?: {
    ticketId: string;
    name: string;
    category: string | null;
    passCount: number;
    /** Valid passes still to be used after this scan. */
    remaining: number;
  };
  pass?: {
    passNo: number;
    usedAt: Date | null;
    usedGate: string | null;
  };
}

interface PassInfo {
  passNo: number;
  status: PassStatus;
  usedAt: Date | null;
  usedGate: string | null;
  ticketId: string;
  name: string;
  category: string | null;
  ticketStatus: TicketStatus;
  passCount: number;
  remaining: number;
}

/** The pass, its booking and the booking's pass counts, in one round trip. */
async function loadPassInfo(passId: string): Promise<PassInfo | null> {
  const rows = await prisma.$queryRaw<PassInfo[]>`
    SELECT p."passNo", p."status", p."usedAt", p."usedGate",
           t."id" AS "ticketId", t."name", t."category", t."status" AS "ticketStatus",
           (SELECT count(*)::int FROM ${table('Pass')} x WHERE x."ticketId" = t."id") AS "passCount",
           (SELECT count(*)::int FROM ${table('Pass')} x WHERE x."ticketId" = t."id" AND x."status" = 'valid') AS "remaining"
    FROM ${table('Pass')} p
    JOIN ${table('Ticket')} t ON t."id" = p."ticketId"
    WHERE p."id" = ${passId}::uuid`;
  return rows[0] ?? null;
}

function describe(info: PassInfo): Pick<ScanOutcome, 'booking' | 'pass'> {
  return {
    booking: {
      ticketId: info.ticketId,
      name: info.name,
      category: info.category,
      passCount: info.passCount,
      remaining: info.remaining,
    },
    pass: { passNo: info.passNo, usedAt: info.usedAt, usedGate: info.usedGate },
  };
}

/** Every scan attempt is logged, whatever its result. `passId` is null when the QR matched no pass. */
function logCheckins(db: Prisma.TransactionClient | typeof prisma, session: GateSession, passIds: (string | null)[], result: CheckinResult) {
  return db.checkin.createMany({
    data: passIds.map((passId) => ({ passId, gate: session.gate, deviceId: session.deviceId, result })),
  });
}

function auditAdmit(
  db: Prisma.TransactionClient | typeof prisma,
  session: GateSession,
  action: string,
  entity: { type: 'Pass' | 'Ticket'; id: string },
  meta?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({
    data: {
      actorType: 'gate',
      actorId: session.gateId,
      actorLabel: `${session.gate} / ${session.deviceId}`,
      action,
      entityType: entity.type,
      entityId: entity.id,
      meta,
    },
  });
}

/**
 * Checks a scanned QR code and, if it is a valid unused pass, marks it used.
 *
 * The check-in itself is ONE conditional UPDATE: the pass becomes "used" only if it is
 * "valid" at that instant. If two gates scan the same pass at once, the database lets
 * exactly one of those updates change the row; the other sees zero rows updated.
 */
export async function scanPass(qr: unknown, session: GateSession): Promise<ScanOutcome> {
  const passId = verifyQr(qr);
  if (!passId) {
    // Not something this server signed: forged, altered, or not a pass at all.
    await logCheckins(prisma, session, [null], 'invalid');
    return { result: 'invalid' };
  }

  const usedAt = new Date();
  const updated = await prisma.pass.updateMany({
    where: { id: passId, status: 'valid' },
    data: { status: 'used', usedAt, usedGate: session.gate },
  });

  if (updated.count === 1) {
    // One further round trip: what to show, the scan log and the audit entry, all at once.
    const [info] = await Promise.all([
      loadPassInfo(passId),
      logCheckins(prisma, session, [passId], 'ok'),
      auditAdmit(prisma, session, 'checkin.scan', { type: 'Pass', id: passId }),
    ]);
    if (!info) return { result: 'ok' }; // removed in the same instant; the admission still stands
    return { result: 'ok', ...describe(info) };
  }

  // Nothing was updated: find out why, for the volunteer's screen.
  const info = await loadPassInfo(passId);
  if (!info) {
    // Correctly signed, but the pass no longer exists (its booking was reduced or removed).
    await logCheckins(prisma, session, [null], 'invalid');
    return { result: 'invalid' };
  }
  const result: CheckinResult = info.status === 'cancelled' ? 'cancelled' : 'already_used';
  await logCheckins(prisma, session, [passId], result);
  return { result, ...describe(info) };
}

async function bookingSummary(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, name: true, category: true, status: true, passes: { select: { status: true } } },
  });
  if (!ticket) throw new HttpError(404, 'not_found', 'Booking not found');
  return {
    status: ticket.status,
    booking: {
      ticketId: ticket.id,
      name: ticket.name,
      category: ticket.category,
      passCount: ticket.passes.length,
      remaining: ticket.passes.filter((pass) => pass.status === 'valid').length,
    },
  };
}

/** Admits everyone still to come on a booking: all of its valid passes, in one transaction. */
export async function admitAllRemaining(ticketId: string, session: GateSession) {
  const admitted = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE ${table('Pass')}
      SET "status" = 'used', "usedAt" = now(), "usedGate" = ${session.gate}
      WHERE "ticketId" = ${ticketId}::uuid AND "status" = 'valid'
      RETURNING "id"`;
    if (rows.length > 0) {
      await logCheckins(tx, session, rows.map((row) => row.id), 'ok');
      await auditAdmit(tx, session, 'checkin.admit_all', { type: 'Ticket', id: ticketId }, { admitted: rows.length });
    }
    return rows.length;
  }, TX_OPTIONS);

  const summary = await bookingSummary(ticketId);
  return { admitted, cancelled: summary.status === 'cancelled', booking: summary.booking };
}

/** Manual entry: admits one person on a booking (its lowest-numbered valid pass). */
export async function admitOne(ticketId: string, session: GateSession): Promise<ScanOutcome> {
  // SKIP LOCKED: two volunteers pressing "Admit 1" on the same booking at once admit two
  // different passes, never the same one twice.
  const rows = await prisma.$queryRaw<{ id: string; passNo: number; usedAt: Date }[]>`
    UPDATE ${table('Pass')}
    SET "status" = 'used', "usedAt" = now(), "usedGate" = ${session.gate}
    WHERE "id" = (
      SELECT "id" FROM ${table('Pass')}
      WHERE "ticketId" = ${ticketId}::uuid AND "status" = 'valid'
      ORDER BY "passNo"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ) AND "status" = 'valid'
    RETURNING "id", "passNo", "usedAt"`;

  const admitted = rows[0];
  if (admitted) {
    await Promise.all([
      logCheckins(prisma, session, [admitted.id], 'ok'),
      auditAdmit(prisma, session, 'checkin.manual', { type: 'Pass', id: admitted.id }, { ticketId }),
    ]);
  }
  const summary = await bookingSummary(ticketId);
  if (admitted) {
    return {
      result: 'ok',
      booking: summary.booking,
      pass: { passNo: admitted.passNo, usedAt: admitted.usedAt, usedGate: session.gate },
    };
  }
  return { result: summary.status === 'cancelled' ? 'cancelled' : 'already_used', booking: summary.booking };
}

/**
 * Manual lookup when a QR cannot be scanned: an exact order ID, or the last four digits of
 * the buyer's phone. Exact matches only, so the scanner cannot be used to browse bookings.
 */
export async function lookupBookings(query: string) {
  const q = query.trim();
  const where: Prisma.TicketWhereInput = /^\d{4}$/.test(q)
    ? { OR: [{ phone: { endsWith: q } }, { orderId: { equals: q, mode: 'insensitive' } }] }
    : { orderId: { equals: q, mode: 'insensitive' } };

  const tickets = await prisma.ticket.findMany({
    where,
    select: { id: true, name: true, category: true, status: true, passes: { select: { status: true } } },
    orderBy: { orderId: 'asc' },
    take: 10,
  });
  return {
    results: tickets.map((ticket) => ({
      ticketId: ticket.id,
      name: ticket.name,
      category: ticket.category,
      cancelled: ticket.status === 'cancelled',
      passCount: ticket.passes.length,
      entered: ticket.passes.filter((pass) => pass.status === 'used').length,
      remaining: ticket.passes.filter((pass) => pass.status === 'valid').length,
    })),
  };
}

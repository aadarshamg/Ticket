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
async function logCheckins(
  db: Prisma.TransactionClient | typeof prisma,
  session: GateSession,
  passIds: (string | null)[],
  result: CheckinResult,
  clientRef?: string,
): Promise<void> {
  const rows = passIds.map((passId) => ({ passId, gate: session.gate, deviceId: session.deviceId, result }));
  if (!clientRef) {
    await db.checkin.createMany({ data: rows });
    return;
  }
  // clientRef is unique. If it is already taken (the scanner repeated itself, or misused an
  // ID), still log the attempt, just without the reference: no scan goes unrecorded.
  const saved = await db.checkin.createMany({ data: rows.map((row) => ({ ...row, clientRef })), skipDuplicates: true });
  if (saved.count < rows.length) await db.checkin.createMany({ data: rows });
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

interface AdmittedRow {
  passNo: number;
  usedAt: Date;
  ticketId: string;
  name: string;
  category: string | null;
  passCount: number;
  /** Valid passes on the booking just before this scan (the statement sees its starting snapshot). */
  validBefore: number;
  /** 1 if the scan log row was written; 0 if its clientRef was already taken. */
  logged: number;
}

/**
 * The common case at a gate, done in a single database round trip: mark the pass used (only if
 * it is still valid), write the scan log and the audit entry, and read what the volunteer sees.
 * Returns null if the pass was not valid, leaving the caller to work out why.
 */
async function admitInOneTrip(passId: string, session: GateSession, clientRef?: string): Promise<ScanOutcome | null> {
  const rows = await prisma.$queryRaw<AdmittedRow[]>`
    WITH upd AS (
      UPDATE ${table('Pass')}
      SET "status" = 'used', "usedAt" = now(), "usedGate" = ${session.gate}
      WHERE "id" = ${passId}::uuid AND "status" = 'valid'
      RETURNING "id", "ticketId", "passNo", "usedAt"
    ),
    logged AS (
      INSERT INTO ${table('Checkin')} ("id", "passId", "gate", "deviceId", "result", "clientRef")
      SELECT gen_random_uuid(), upd."id", ${session.gate}, ${session.deviceId}, 'ok', ${clientRef ?? null}::text
      FROM upd
      ON CONFLICT ("clientRef") DO NOTHING
      RETURNING 1
    ),
    audited AS (
      INSERT INTO ${table('AuditLog')} ("id", "actorType", "actorId", "actorLabel", "action", "entityType", "entityId")
      SELECT gen_random_uuid(), 'gate', ${session.gateId}, ${`${session.gate} / ${session.deviceId}`}, 'checkin.scan', 'Pass', upd."id"::text
      FROM upd
      RETURNING 1
    )
    SELECT upd."passNo", upd."usedAt", t."id" AS "ticketId", t."name", t."category",
           (SELECT count(*)::int FROM ${table('Pass')} x WHERE x."ticketId" = t."id") AS "passCount",
           (SELECT count(*)::int FROM ${table('Pass')} x WHERE x."ticketId" = t."id" AND x."status" = 'valid') AS "validBefore",
           (SELECT count(*)::int FROM logged) AS "logged"
    FROM upd
    JOIN ${table('Ticket')} t ON t."id" = upd."ticketId"`;

  const row = rows[0];
  if (!row) return null;
  // The scanner re-used an ID that is already taken: still log the scan, just without it.
  if (row.logged === 0) await logCheckins(prisma, session, [passId], 'ok');
  return {
    result: 'ok',
    booking: {
      ticketId: row.ticketId,
      name: row.name,
      category: row.category,
      passCount: row.passCount,
      remaining: Math.max(0, row.validBefore - 1),
    },
    pass: { passNo: row.passNo, usedAt: row.usedAt, usedGate: session.gate },
  };
}

/**
 * Checks a scanned QR code and, if it is a valid unused pass, marks it used.
 *
 * The check-in itself is ONE conditional UPDATE: the pass becomes "used" only if it is
 * "valid" at that instant. If two gates scan the same pass at once, the database lets
 * exactly one of those updates change the row; the other sees zero rows updated.
 *
 * `clientRef` is the scanner's own ID for this scan. If the answer never reaches the phone
 * and it falls back to its offline list, the later sync carries the same ID and is
 * recognised as this scan rather than counted as a second admission.
 */
export async function scanPass(qr: unknown, session: GateSession, clientRef?: string): Promise<ScanOutcome> {
  const passId = verifyQr(qr);
  if (!passId) {
    // Not something this server signed: forged, altered, or not a pass at all.
    await logCheckins(prisma, session, [null], 'invalid', clientRef);
    return { result: 'invalid' };
  }

  const admitted = await admitInOneTrip(passId, session, clientRef);
  if (admitted) return admitted;

  // Nothing was updated: find out why, for the volunteer's screen. (The uncommon path.)
  const info = await loadPassInfo(passId);
  if (!info) {
    // Correctly signed, but the pass no longer exists (its booking was reduced or removed).
    await logCheckins(prisma, session, [null], 'invalid', clientRef);
    return { result: 'invalid' };
  }
  if (clientRef && info.status === 'used') {
    // Was it this very scan that used the pass? That happens when the first answer was lost on
    // the way to the phone and it asks again with the same ID. Give the same answer, once more.
    const mine = await prisma.checkin.findUnique({ where: { clientRef }, select: { passId: true, result: true } });
    if (mine?.result === 'ok' && mine.passId === passId) return { result: 'ok', ...describe(info) };
  }
  const result: CheckinResult = info.status === 'cancelled' ? 'cancelled' : 'already_used';
  await logCheckins(prisma, session, [passId], result, clientRef);
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

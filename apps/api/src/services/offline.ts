import { randomUUID } from 'node:crypto';
import { Prisma, type CheckinResult } from '@prisma/client';
import { prisma } from '../db';
import { hashQr, signList } from '../lib/offlineList';
import { signPass, verifyQr } from '../lib/qr';
import type { GateSession } from '../lib/session';

/**
 * The list a scanner keeps for working without a connection: one short hash per pass that
 * is valid right now, signed so the phone can tell it is genuine and complete.
 */
export async function buildOfflineList() {
  const passes = await prisma.pass.findMany({
    where: { status: 'valid', ticket: { status: 'active' } },
    select: { id: true },
  });
  const hashes = passes.map((pass) => hashQr(signPass(pass.id))).sort();
  const listId = randomUUID();
  const generatedAt = new Date().toISOString();
  return { listId, generatedAt, count: hashes.length, hashes, ...signList(listId, generatedAt, hashes) };
}

export interface OfflineCheckin {
  /** Made up by the phone for each scan; makes syncing the same record twice harmless. */
  clientRef: string;
  /** The QR text exactly as scanned. The server re-verifies it; the phone's verdict is not trusted. */
  qr: string;
  /** When the phone admitted the person. */
  scannedAt: Date;
}

async function recordedResult(clientRef: string): Promise<CheckinResult | null> {
  const existing = await prisma.checkin.findUnique({ where: { clientRef }, select: { result: true } });
  return existing?.result ?? null;
}

/**
 * Records one admission that a phone made while offline. The person is already inside, so
 * this never "refuses": it marks the pass used if it still can, and otherwise stores what
 * went wrong (already used elsewhere, cancelled, not a real pass) for the conflicts report.
 */
async function syncOne(item: OfflineCheckin, session: GateSession): Promise<CheckinResult> {
  const already = await recordedResult(item.clientRef);
  if (already) return already; // sent before (or the online scan got through after all)

  // A phone's clock can be wrong; never record an entry in the future.
  const scannedAt = new Date(Math.min(item.scannedAt.getTime(), Date.now()));

  let passId = verifyQr(item.qr);
  let result: CheckinResult = 'invalid';
  if (passId) {
    const updated = await prisma.pass.updateMany({
      where: { id: passId, status: 'valid' },
      data: { status: 'used', usedAt: scannedAt, usedGate: session.gate },
    });
    if (updated.count === 1) {
      result = 'ok';
    } else {
      const pass = await prisma.pass.findUnique({ where: { id: passId }, select: { status: true } });
      if (!pass) passId = null; // correctly signed, but the pass no longer exists
      else result = pass.status === 'cancelled' ? 'cancelled' : 'already_used';
    }
  }

  try {
    await prisma.checkin.create({
      data: {
        passId,
        gate: session.gate,
        deviceId: session.deviceId,
        result,
        offline: true,
        clientRef: item.clientRef,
        scannedAt,
      },
    });
  } catch (error) {
    // The same record arrived twice at once; the first one in is the record.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return (await recordedResult(item.clientRef)) ?? result;
    }
    throw error;
  }

  if (passId) {
    await prisma.auditLog.create({
      data: {
        actorType: 'gate',
        actorId: session.gateId,
        actorLabel: `${session.gate} / ${session.deviceId}`,
        action: result === 'ok' ? 'checkin.offline' : 'checkin.offline_conflict',
        entityType: 'Pass',
        entityId: passId,
        meta: { result, scannedAt: scannedAt.toISOString() },
      },
    });
  }
  return result;
}

/** Uploads a phone's stored offline admissions. Safe to call again with the same records. */
export async function syncOfflineCheckins(items: OfflineCheckin[], session: GateSession) {
  const results: { clientRef: string; result: CheckinResult }[] = [];
  for (const item of items) {
    results.push({ clientRef: item.clientRef, result: await syncOne(item, session) });
  }
  return { results };
}

/**
 * Offline admissions that turned out not to be valid once synced: the pass had already been
 * used at another gate, was cancelled, or was not a real pass. These people did get in.
 */
export async function listConflicts() {
  const rows = await prisma.checkin.findMany({
    where: { offline: true, result: { not: 'ok' } },
    orderBy: { scannedAt: 'desc' },
    take: 500,
    select: {
      id: true,
      result: true,
      gate: true,
      deviceId: true,
      scannedAt: true,
      pass: {
        select: {
          passNo: true,
          usedAt: true,
          usedGate: true,
          ticket: { select: { orderId: true, name: true, passCount: true } },
        },
      },
    },
  });
  return {
    conflicts: rows.map((row) => ({
      id: row.id,
      result: row.result,
      /** Where and when the person was let in offline. */
      gate: row.gate,
      deviceId: row.deviceId,
      scannedAt: row.scannedAt,
      booking: row.pass
        ? { orderId: row.pass.ticket.orderId, name: row.pass.ticket.name, passNo: row.pass.passNo, passCount: row.pass.ticket.passCount }
        : null,
      /** The entry that holds the pass (for "already used": the other admission). */
      recordedEntry: row.pass?.usedAt ? { gate: row.pass.usedGate, at: row.pass.usedAt } : null,
    })),
  };
}

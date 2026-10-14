import { TICKET_TEMPLATE } from '../config/constants';
import { prisma } from '../db';
import { currentNight, eventNights, nightFromDb, nightLabel } from '../lib/nights';
import { table } from '../lib/sql';
import { getEventCached } from './eventCache';

/**
 * Numbers for the live dashboard. Small aggregate queries run together, so the answer
 * costs one round trip's worth of time however many bookings there are.
 */
export async function getStats() {
  const [ticketsByStatus, passesByStatus, messagesByStatus, unsent, entriesByGate, conflicts, passesByNight, event] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], _count: true }),
    prisma.pass.groupBy({ by: ['status'], _count: true }),
    prisma.message.groupBy({ by: ['status'], where: { template: TICKET_TEMPLATE }, _count: true }),
    prisma.ticket.count({ where: { status: 'active', messages: { none: { template: TICKET_TEMPLATE } } } }),
    prisma.pass.groupBy({ by: ['usedGate'], where: { status: 'used' }, _count: true, _max: { usedAt: true } }),
    prisma.checkin.count({ where: { offline: true, result: { not: 'ok' } } }),
    prisma.$queryRaw<{ night: Date | null; status: string; count: number }[]>`
      SELECT t."night", p."status"::text AS "status", count(*)::int AS "count"
      FROM ${table('Pass')} p JOIN ${table('Ticket')} t ON t."id" = p."ticketId"
      WHERE p."status" <> 'cancelled'
      GROUP BY 1, 2`,
    getEventCached(),
  ]);

  const bookings = { total: 0, active: 0, cancelled: 0 };
  for (const row of ticketsByStatus) {
    bookings[row.status] = row._count;
    bookings.total += row._count;
  }

  const passes = { total: 0, valid: 0, used: 0, cancelled: 0 };
  for (const row of passesByStatus) {
    passes[row.status] = row._count;
    passes.total += row._count;
  }

  const messages = { unsent, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of messagesByStatus) messages[row.status] = row._count;

  const gates = entriesByGate
    .map((row) => ({ gate: row.usedGate ?? 'Unknown', entered: row._count, lastEntryAt: row._max.usedAt }))
    .sort((a, b) => b.entered - a.entered);

  // Entry per night, on a multi-night event. Bookings without a night are counted on their own.
  const nightKeys = event ? eventNights(event) : [];
  const nights: { night: string | null; label: string; entered: number; expected: number }[] = [];
  if (nightKeys.length > 1) {
    const row = (night: string | null) => {
      let found = nights.find((item) => item.night === night);
      if (!found) {
        found = { night, label: night ? nightLabel(night) : 'Any night', entered: 0, expected: 0 };
        nights.push(found);
      }
      return found;
    };
    for (const night of nightKeys) row(night);
    for (const { night, status, count } of passesByNight) {
      const item = row(nightFromDb(night));
      item.expected += count;
      if (status === 'used') item.entered += count;
    }
  }

  return {
    generatedAt: new Date(),
    bookings,
    passes,
    messages,
    /** People who have entered, and people who still can. Cancelled passes count as neither. */
    entered: passes.used,
    stillToCome: passes.valid,
    gates,
    /** Empty unless the event has more than one night. */
    nights,
    /** The night being checked in now ("2026-10-17"), or null. */
    tonight: event ? currentNight(event) : null,
    /** Offline entries that turned out not to be valid (see Admin > Conflicts). */
    conflicts,
  };
}

import { TICKET_TEMPLATE } from '../config/constants';
import { prisma } from '../db';

/**
 * Numbers for the live dashboard. Six small aggregate queries run together, so the answer
 * costs one round trip's worth of time however many bookings there are.
 */
export async function getStats() {
  const [ticketsByStatus, passesByStatus, messagesByStatus, unsent, entriesByGate, conflicts] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], _count: true }),
    prisma.pass.groupBy({ by: ['status'], _count: true }),
    prisma.message.groupBy({ by: ['status'], where: { template: TICKET_TEMPLATE }, _count: true }),
    prisma.ticket.count({ where: { status: 'active', messages: { none: { template: TICKET_TEMPLATE } } } }),
    prisma.pass.groupBy({ by: ['usedGate'], where: { status: 'used' }, _count: true, _max: { usedAt: true } }),
    prisma.checkin.count({ where: { offline: true, result: { not: 'ok' } } }),
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

  return {
    generatedAt: new Date(),
    bookings,
    passes,
    messages,
    /** People who have entered, and people who still can. Cancelled passes count as neither. */
    entered: passes.used,
    stillToCome: passes.valid,
    gates,
    /** Offline entries that turned out not to be valid (see Admin > Conflicts). */
    conflicts,
  };
}

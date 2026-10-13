import { Prisma } from '@prisma/client';
import { prisma } from '../db';

/** Personal data is kept this long after the event ends, then removed (DPDP Act 2023: purpose limitation). */
export const RETENTION_DAYS = 30;

export interface PurgeCounts {
  bookings: number;
  passes: number;
  messages: number;
  checkins: number;
  uploads: number;
  auditEntriesScrubbed: number;
}

export interface PurgePlan {
  eventName: string | null;
  eventEndedAt: Date | null;
  /** The first moment the purge is due: 30 days after the event ended. */
  dueAt: Date | null;
  due: boolean;
  counts: PurgeCounts;
}

/** Audit entries whose details can identify a buyer (order IDs, email addresses tried at login). */
const PERSONAL_AUDIT: Prisma.AuditLogWhereInput = {
  OR: [
    { entityType: { in: ['Ticket', 'Pass', 'Upload'] } },
    { action: { in: ['admin.login_failed', 'send.test'] } },
  ],
  meta: { not: Prisma.DbNull },
};

/** What a purge would remove, and whether it is due yet. Changes nothing. */
export async function planPurge(now = new Date()): Promise<PurgePlan> {
  const [event, bookings, passes, messages, checkins, uploads, auditEntriesScrubbed] = await Promise.all([
    prisma.event.findUnique({ where: { id: 1 }, select: { name: true, endsAt: true } }),
    prisma.ticket.count(),
    prisma.pass.count(),
    prisma.message.count(),
    prisma.checkin.count(),
    prisma.upload.count(),
    prisma.auditLog.count({ where: PERSONAL_AUDIT }),
  ]);
  const dueAt = event ? new Date(event.endsAt.getTime() + RETENTION_DAYS * 86_400_000) : null;
  return {
    eventName: event?.name ?? null,
    eventEndedAt: event?.endsAt ?? null,
    dueAt,
    due: dueAt !== null && now >= dueAt,
    counts: { bookings, passes, messages, checkins, uploads, auditEntriesScrubbed },
  };
}

/**
 * Permanently removes every booking, pass, message, scan record and upload, and strips the
 * details from audit entries that could identify a buyer (the entry itself, with its action
 * and time, stays). Event settings, gates and admin logins are kept. One transaction: either
 * all of it happens or none of it.
 */
export async function purgeBookingData(): Promise<PurgeCounts> {
  return prisma.$transaction(
    async (tx) => {
      // Order matters only for the count: deleting bookings would cascade to passes and messages.
      const checkins = await tx.checkin.deleteMany({});
      const messages = await tx.message.deleteMany({});
      const passes = await tx.pass.deleteMany({});
      const bookings = await tx.ticket.deleteMany({});
      const uploads = await tx.upload.deleteMany({});
      const scrubbed = await tx.auditLog.updateMany({ where: PERSONAL_AUDIT, data: { meta: Prisma.DbNull } });

      const counts: PurgeCounts = {
        bookings: bookings.count,
        passes: passes.count,
        messages: messages.count,
        checkins: checkins.count,
        uploads: uploads.count,
        auditEntriesScrubbed: scrubbed.count,
      };
      await tx.auditLog.create({
        data: {
          actorType: 'system',
          actorLabel: 'purge-data script',
          action: 'data.purge',
          meta: { ...counts },
        },
      });
      return counts;
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
}

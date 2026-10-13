import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';

/** What the audit log page can filter by: a group of related actions. */
export const AUDIT_GROUPS = {
  uploads: ['upload.'],
  bookings: ['ticket.'],
  sending: ['send.'],
  checkins: ['checkin.'],
  settings: ['event.', 'gate.create', 'gate.update', 'gate.delete'],
  signins: ['admin.', 'gate.login'],
  data: ['export.', 'data.', 'seed.'],
} as const;

export const auditQuerySchema = z.object({
  group: z.enum(Object.keys(AUDIT_GROUPS) as [keyof typeof AUDIT_GROUPS, ...(keyof typeof AUDIT_GROUPS)[]]).optional(),
  /** Matches who did it (an admin's email, or a gate name). */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Who did what, when: newest first. */
export async function listAuditLog(query: AuditQuery) {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (query.group) {
    and.push({ OR: AUDIT_GROUPS[query.group].map((prefix) => ({ action: { startsWith: prefix } })) });
  }
  if (query.q) and.push({ actorLabel: { contains: query.q, mode: 'insensitive' } });
  const where: Prisma.AuditLogWhereInput = and.length > 0 ? { AND: and } : {};

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        createdAt: true,
        actorType: true,
        actorLabel: true,
        action: true,
        entityType: true,
        entityId: true,
        meta: true,
      },
    }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

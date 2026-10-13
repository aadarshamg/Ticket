import type { ActorType, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface Actor {
  type: ActorType;
  id?: string;
  /** Human-readable: admin email, "Gate A / device", or the script name. */
  label: string;
}

export interface AuditEntity {
  type: string;
  id?: string;
}

/** Records who did what. Call inside the same transaction as the write it describes. */
export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  entity?: AuditEntity,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.id,
      actorLabel: actor.label,
      action,
      entityType: entity?.type,
      entityId: entity?.id,
      meta,
    },
  });
}

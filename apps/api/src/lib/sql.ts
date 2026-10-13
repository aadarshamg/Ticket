import { Prisma } from '@prisma/client';
import { env } from '../config/env';

type TableName = 'Event' | 'Gate' | 'Ticket' | 'Pass' | 'Message' | 'Checkin' | 'Upload' | 'AdminUser' | 'AuditLog';

/**
 * Schema-qualified table reference for raw SQL, e.g. "ticketing"."Pass".
 * Required because the pooled connection does not set search_path. Safe to inline:
 * DB_SCHEMA is validated against /^[a-z_][a-z0-9_]*$/ and the table name is a fixed union.
 */
export function table(name: TableName): Prisma.Sql {
  return Prisma.raw(`"${env.DB_SCHEMA}"."${name}"`);
}

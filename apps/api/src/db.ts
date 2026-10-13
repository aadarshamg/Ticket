import { PrismaClient } from '@prisma/client';
import { env } from './config/env';
import { withSchema } from './lib/dbUrl';

/**
 * Model queries are schema-qualified by Prisma. Raw SQL is not, and the pooled (pgbouncer)
 * connection does not set search_path, so raw SQL must name tables as "<DB_SCHEMA>"."Table".
 */
export const prisma = new PrismaClient({
  datasourceUrl: withSchema(env.DATABASE_URL, env.DB_SCHEMA),
});

/** Interactive-transaction limits, sized for a managed database reached over the network. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

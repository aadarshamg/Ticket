/**
 * Applies pending database migrations, for production containers:
 *
 *   node dist/scripts/migrate.js
 *
 * Same job as `npm run db:deploy` in development, without needing tsx. It applies
 * DB_SCHEMA to the connection URLs, so they can be given exactly as the provider shows them.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadRootEnv } from '../config/loadEnv';
import { withSchema } from '../lib/dbUrl';

loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const schema = process.env.DB_SCHEMA || 'ticketing';
const cli = require.resolve('prisma/build/index.js');

const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
  // The Prisma schema and migrations live in apps/api/prisma, two levels above this file.
  cwd: path.resolve(__dirname, '../..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: withSchema(url, schema),
    // Migrations need a direct (non-pooled) connection where the provider offers one.
    DIRECT_URL: withSchema(process.env.DIRECT_URL || url, schema),
  },
});
process.exit(result.status ?? 1);

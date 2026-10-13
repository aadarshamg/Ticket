/**
 * Runs the Prisma CLI with the repo-root .env loaded and DB_SCHEMA applied to
 * the connection URLs, so `.env` can hold the URLs exactly as Supabase gives them.
 *
 *   npm run prisma -w apps/api -- migrate status
 */
import { spawnSync } from 'node:child_process';
import { loadRootEnv } from '../src/config/loadEnv';
import { withSchema } from '../src/lib/dbUrl';

loadRootEnv();

const args = process.argv.slice(2);
const needsNoDatabase =
  ['generate', 'format', 'validate'].includes(args[0] ?? '') ||
  (args[0] === 'migrate' && args[1] === 'diff');

const schema = process.env.DB_SCHEMA || 'ticketing';
const url = process.env.DATABASE_URL;

if (url) {
  process.env.DATABASE_URL = withSchema(url, schema);
  process.env.DIRECT_URL = withSchema(process.env.DIRECT_URL || url, schema);
} else if (needsNoDatabase) {
  process.env.DATABASE_URL = 'postgresql://offline:offline@localhost:5432/offline';
  process.env.DIRECT_URL = process.env.DATABASE_URL;
} else {
  console.error('DATABASE_URL is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);

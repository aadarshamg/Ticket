import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Redis } from 'ioredis';
import { loadRootEnv } from '../../src/config/loadEnv';
import { withSchema } from '../../src/lib/dbUrl';
import { testSchemaName } from '../testSchema';

/** Fails fast with a useful message if the send queue's Redis is not running. */
async function checkRedis(): Promise<void> {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    throw new Error(
      `Integration tests need Redis, but nothing answered at ${url}. ` +
        'Start it with "docker compose up -d redis" (or "npm run redis" on Windows).',
    );
  } finally {
    redis.disconnect();
  }
}

/** Applies migrations to the test schema once before the integration suite. */
export default async function setup(): Promise<void> {
  loadRootEnv();
  await checkRedis();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Integration tests need a database. Set DATABASE_URL (and DIRECT_URL) in .env; ' +
        'they run in a separate "<DB_SCHEMA>_test" schema and do not touch real data.',
    );
  }
  const schema = testSchemaName();
  const apiRoot = path.resolve(__dirname, '../..');
  const cli = createRequire(__filename).resolve('prisma/build/index.js');

  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: withSchema(url, schema),
      DIRECT_URL: withSchema(process.env.DIRECT_URL || url, schema),
    },
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed for schema "${schema}"`);
  }
}

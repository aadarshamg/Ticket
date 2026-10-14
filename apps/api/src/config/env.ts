import { z } from 'zod';
import { loadRootEnv } from './loadEnv';
import { productionConfigProblems } from './production';

loadRootEnv();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z
    .string({ required_error: 'required (Postgres connection string)' })
    .regex(/^postgres(ql)?:\/\//, 'must start with postgresql://'),
  DIRECT_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must start with postgresql://')
    .optional(),
  DB_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, 'lowercase letters, digits and underscores only')
    .default('ticketing'),

  REDIS_URL: z.string().optional(),

  QR_SECRET: z.string({ required_error: 'required' }).min(32, 'must be at least 32 characters'),
  SESSION_SECRET: z.string({ required_error: 'required' }).min(32, 'must be at least 32 characters'),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** How long a gate volunteer stays signed in to the scanner. */
  GATE_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(16),

  /** mock = log only; cloud = Meta WhatsApp Cloud API. */
  MESSAGE_SENDER: z.enum(['mock', 'cloud']).default('mock'),
  SEND_RATE_PER_SECOND: z.coerce.number().int().min(1).max(80).default(20),
  /** First retry delay for temporary send errors; doubles each retry. */
  SEND_RETRY_BASE_MS: z.coerce.number().int().min(1).default(2000),
  /** Run the send worker inside the API process. Set false when running `npm run worker` separately. */
  RUN_WORKER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Namespace for queue keys in Redis, so tests never touch real queues. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('tk'),

  WA_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'looks like v23.0')
    .default('v23.0'),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_APP_SECRET: z.string().optional(),
  WA_VERIFY_TOKEN: z.string().optional(),
});

// An empty value in .env ("KEY=") means "not set".
const raw = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
);

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    `Invalid environment configuration:\n${lines.join('\n')}\n` +
      'Copy .env.example to .env and fill in the missing values.',
  );
}

// In production, refuse to start with settings that would fail on the day.
const productionProblems = productionConfigProblems(parsed.data);
if (productionProblems.length > 0) {
  throw new Error(`Not safe to run in production:\n${productionProblems.map((line) => `  - ${line}`).join('\n')}`);
}

export const env = parsed.data;
export type Env = typeof env;

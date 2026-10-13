import { z } from 'zod';
import { loadRootEnv } from './loadEnv';

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

export const env = parsed.data;
export type Env = typeof env;

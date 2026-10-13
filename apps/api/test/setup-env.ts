import { loadRootEnv } from '../src/config/loadEnv';
import { testSchemaName } from './testSchema';

// Runs before each test file, ahead of any import of src/config/env.
loadRootEnv();

process.env.NODE_ENV = 'test';
process.env.DB_SCHEMA = testSchemaName();
process.env.SESSION_SECRET ||= 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.QR_SECRET ||= 'test-qr-secret-0123456789-abcdefghijklmnopqrstuv';
// Messaging: a separate queue namespace, fast retries, and fixed webhook secrets.
process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
process.env.QUEUE_PREFIX = 'tk-test';
process.env.MESSAGE_SENDER = 'mock';
process.env.SEND_RETRY_BASE_MS = '20';
process.env.SEND_RATE_PER_SECOND = '80';
process.env.WA_APP_SECRET = 'test-app-secret-0123456789abcdef';
process.env.WA_VERIFY_TOKEN = 'test-verify-token';
// Unit tests never connect; integration tests fail earlier (global setup) if this is missing.
process.env.DATABASE_URL ||= 'postgresql://unit:unit@localhost:5432/unit';

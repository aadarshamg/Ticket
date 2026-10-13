import { loadRootEnv } from '../src/config/loadEnv';
import { testSchemaName } from './testSchema';

// Runs before each test file, ahead of any import of src/config/env.
loadRootEnv();

process.env.NODE_ENV = 'test';
process.env.DB_SCHEMA = testSchemaName();
process.env.SESSION_SECRET ||= 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.QR_SECRET ||= 'test-qr-secret-0123456789-abcdefghijklmnopqrstuv';
// Unit tests never connect; integration tests fail earlier (global setup) if this is missing.
process.env.DATABASE_URL ||= 'postgresql://unit:unit@localhost:5432/unit';

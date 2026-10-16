import { describe, expect, it } from 'vitest';
import { productionConfigProblems, type ProductionConfig } from '../../src/config/production';

const good: ProductionConfig = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://passes.example.com',
  DB_SCHEMA: 'ticketing',
  REDIS_URL: 'rediss://default:secret@redis.example.com:6379',
  QR_SECRET: 'q'.repeat(48),
  SESSION_SECRET: 's'.repeat(48),
  MESSAGE_SENDER: 'cloud',
  WA_PHONE_NUMBER_ID: '1234567890',
  WA_ACCESS_TOKEN: 'token',
  WA_APP_SECRET: 'app-secret',
  WA_VERIFY_TOKEN: 'verify-token',
};

describe('productionConfigProblems', () => {
  it('accepts a complete production configuration', () => {
    expect(productionConfigProblems(good)).toEqual([]);
  });

  it('does not interfere with development or tests', () => {
    expect(
      productionConfigProblems({ ...good, NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://localhost:3000', REDIS_URL: undefined }),
    ).toEqual([]);
  });

  it('insists on an https public address that is not localhost', () => {
    expect(productionConfigProblems({ ...good, PUBLIC_BASE_URL: 'http://passes.example.com' })).toEqual([
      expect.stringContaining('PUBLIC_BASE_URL must be'),
    ]);
    expect(productionConfigProblems({ ...good, PUBLIC_BASE_URL: 'https://localhost:3000' })).toEqual([
      expect.stringContaining('localhost'),
    ]);
  });

  it('requires Redis, distinct secrets and a real schema', () => {
    expect(productionConfigProblems({ ...good, REDIS_URL: undefined })).toEqual([expect.stringContaining('REDIS_URL')]);
    expect(productionConfigProblems({ ...good, SESSION_SECRET: good.QR_SECRET })).toEqual([
      expect.stringContaining('two different values'),
    ]);
    expect(productionConfigProblems({ ...good, DB_SCHEMA: 'ticketing_test' })).toEqual([expect.stringContaining('test schema')]);
  });

  it('requires every WhatsApp value when real sending is switched on, and none in mock mode', () => {
    const problems = productionConfigProblems({ ...good, WA_ACCESS_TOKEN: undefined, WA_APP_SECRET: undefined });
    expect(problems).toEqual([
      'WA_ACCESS_TOKEN is required when MESSAGE_SENDER=cloud',
      'WA_APP_SECRET is required when MESSAGE_SENDER=cloud',
    ]);
    expect(
      productionConfigProblems({ ...good, MESSAGE_SENDER: 'mock', WA_PHONE_NUMBER_ID: undefined, WA_ACCESS_TOKEN: undefined, WA_APP_SECRET: undefined, WA_VERIFY_TOKEN: undefined }),
    ).toEqual([]);
  });

  it('requires the WaSarathi ticket link, over https, when sending through WaSarathi', () => {
    const wasarathi = { ...good, MESSAGE_SENDER: 'wasarathi', WA_PHONE_NUMBER_ID: undefined, WA_ACCESS_TOKEN: undefined };
    expect(productionConfigProblems(wasarathi)).toEqual(['WASARATHI_TICKET_URL is required when MESSAGE_SENDER=wasarathi']);
    expect(productionConfigProblems({ ...wasarathi, WASARATHI_TICKET_URL: 'http://panel.example/api' })).toEqual([
      'WASARATHI_TICKET_URL must be an https:// link',
    ]);
    // The API key comes from the link itself, or from WASARATHI_API_TOKEN when the link has none.
    expect(productionConfigProblems({ ...wasarathi, WASARATHI_TICKET_URL: 'https://panel.example/api?apiToken=key' })).toEqual([]);
    expect(productionConfigProblems({ ...wasarathi, WASARATHI_TICKET_URL: 'https://panel.example/api?apiToken=XXXX' })).toEqual([
      'WASARATHI_API_TOKEN is required when the WaSarathi link has no API key',
    ]);
    expect(
      productionConfigProblems({ ...wasarathi, WASARATHI_TICKET_URL: 'https://panel.example/api?apiToken=XXXX', WASARATHI_API_TOKEN: 'key' }),
    ).toEqual([]);
  });

  it('reports every problem at once', () => {
    expect(productionConfigProblems({ ...good, PUBLIC_BASE_URL: 'http://x', REDIS_URL: undefined, DB_SCHEMA: 'a_test' })).toHaveLength(3);
  });
});

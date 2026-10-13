import { describe, expect, it } from 'vitest';
import { withSchema, withTimeouts } from '../../src/lib/dbUrl';
import { testSchemaName } from '../testSchema';

describe('withSchema', () => {
  it('adds the schema to a plain URL', () => {
    expect(withSchema('postgresql://u:p@localhost:5432/db', 'ticketing')).toBe(
      'postgresql://u:p@localhost:5432/db?schema=ticketing',
    );
  });

  it('keeps existing parameters such as pgbouncer', () => {
    const url = withSchema('postgresql://u:p@pooler.example.com:6543/postgres?pgbouncer=true', 'ticketing');
    expect(new URL(url).searchParams.get('pgbouncer')).toBe('true');
    expect(new URL(url).searchParams.get('schema')).toBe('ticketing');
  });

  it('replaces a schema that is already present', () => {
    const url = withSchema('postgresql://u:p@localhost/db?schema=public', 'ticketing_test');
    expect(new URL(url).searchParams.getAll('schema')).toEqual(['ticketing_test']);
  });

  it('preserves a password with special characters', () => {
    const url = withSchema('postgresql://user:p%40ss%2Fword@localhost:5432/db', 'ticketing');
    expect(url).toContain('user:p%40ss%2Fword@');
  });
});

describe('withTimeouts', () => {
  it('allows more time to connect than Prisma’s default, keeping other parameters', () => {
    const url = new URL(withTimeouts('postgresql://u:p@pooler.example.com:6543/postgres?pgbouncer=true&schema=ticketing'));
    expect(url.searchParams.get('connect_timeout')).toBe('20');
    expect(url.searchParams.get('pool_timeout')).toBe('30');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('schema')).toBe('ticketing');
  });

  it('respects timeouts already set in the URL', () => {
    const url = new URL(withTimeouts('postgresql://u:p@localhost/db?connect_timeout=3'));
    expect(url.searchParams.get('connect_timeout')).toBe('3');
    expect(url.searchParams.get('pool_timeout')).toBe('30');
  });
});

describe('test schema', () => {
  it('always ends in _test', () => {
    expect(testSchemaName()).toMatch(/_test$/);
    expect(process.env.DB_SCHEMA).toMatch(/_test$/);
  });
});

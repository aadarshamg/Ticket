/** Returns the connection URL with its `schema` query parameter set to `schema`. */
export function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

/**
 * Seconds allowed for opening a database connection and for waiting on a free one.
 * Prisma's defaults (5 s and 10 s) are too tight for a managed database reached over a
 * long or congested link, where the first TLS handshake can occasionally take longer.
 */
const CONNECT_TIMEOUT_SECONDS = '20';
const POOL_TIMEOUT_SECONDS = '30';

/** Adds the connection timeouts above unless the URL already sets them. */
export function withTimeouts(url: string): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has('connect_timeout')) parsed.searchParams.set('connect_timeout', CONNECT_TIMEOUT_SECONDS);
  if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', POOL_TIMEOUT_SECONDS);
  return parsed.toString();
}

/** Tests always use a schema ending in _test so they can never touch real bookings. */
export function testSchemaName(): string {
  const base = process.env.DB_SCHEMA || 'ticketing';
  return base.endsWith('_test') ? base : `${base}_test`;
}

/** Returns the connection URL with its `schema` query parameter set to `schema`. */
export function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

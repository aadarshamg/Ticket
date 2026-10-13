import { randomBytes } from 'node:crypto';

/** 32 URL-safe symbols with the look-alikes 0/O and 1/I removed. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 12;

/**
 * Secret link code for a booking or a pass: 12 characters, 60 bits of entropy.
 * The alphabet has exactly 32 symbols, so masking a random byte to 5 bits is unbiased.
 */
export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte & 31];
  }
  return code;
}

/** Generates `count` codes that are distinct from each other and from `taken`. */
export function generateUniqueCodes(count: number, taken: ReadonlySet<string> = new Set()): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const code = generateCode();
    if (!taken.has(code)) codes.add(code);
  }
  return [...codes];
}

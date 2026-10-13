import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, generateCode, generateUniqueCodes } from '../../src/lib/codes';

describe('generateCode', () => {
  it('produces 12 characters from the safe alphabet', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateCode()).toMatch(/^[2-9A-HJ-NP-Z]{12}$/);
    }
    expect(CODE_LENGTH).toBe(12);
  });

  it('uses an alphabet of 32 distinct URL-safe symbols with no look-alikes', () => {
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    expect(CODE_ALPHABET).not.toMatch(/[01OIoil]/);
    expect(encodeURIComponent(CODE_ALPHABET)).toBe(CODE_ALPHABET);
  });

  it('does not repeat across 20,000 codes', () => {
    const codes = new Set(Array.from({ length: 20_000 }, generateCode));
    expect(codes.size).toBe(20_000);
  });

  it('uses every symbol of the alphabet', () => {
    const seen = new Set(Array.from({ length: 2_000 }, generateCode).join(''));
    expect(seen.size).toBe(32);
  });
});

describe('generateUniqueCodes', () => {
  it('returns the requested number of distinct codes, avoiding taken ones', () => {
    const taken = new Set(generateUniqueCodes(100));
    const codes = generateUniqueCodes(1_000, taken);
    expect(new Set(codes).size).toBe(1_000);
    expect(codes.some((code) => taken.has(code))).toBe(false);
  });
});

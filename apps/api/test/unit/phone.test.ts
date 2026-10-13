import { describe, expect, it } from 'vitest';
import { maskPhone, normalisePhone } from '../../src/lib/phone';

const ok = (input: unknown) => {
  const result = normalisePhone(input);
  if (!result.ok) throw new Error(`expected ${String(input)} to be valid, got: ${result.reason}`);
  return result.value;
};
const reason = (input: unknown) => {
  const result = normalisePhone(input);
  if (result.ok) throw new Error(`expected ${String(input)} to be invalid, got: ${result.value}`);
  return result.reason;
};

describe('normalisePhone', () => {
  it('stores a 10-digit Indian mobile as +91XXXXXXXXXX', () => {
    expect(ok('9876543210')).toBe('+919876543210');
    expect(ok(9876543210)).toBe('+919876543210'); // numeric spreadsheet cell
    expect(ok('6000000000')).toBe('+916000000000');
  });

  it('accepts the +91, 91 and 0 prefixes', () => {
    expect(ok('+919876543210')).toBe('+919876543210');
    expect(ok('919876543210')).toBe('+919876543210');
    expect(ok(919876543210)).toBe('+919876543210');
    expect(ok('09876543210')).toBe('+919876543210');
  });

  it('ignores spaces, dashes and brackets', () => {
    expect(ok(' 98765 43210 ')).toBe('+919876543210');
    expect(ok('98765-43210')).toBe('+919876543210');
    expect(ok('+91 98765-43210')).toBe('+919876543210');
    expect(ok('(+91) 98765 43210')).toBe('+919876543210');
    expect(ok('+91 98765–43210')).toBe('+919876543210'); // non-breaking space, en dash
  });

  it('keeps a 10-digit number that happens to start with 91', () => {
    expect(ok('9123456789')).toBe('+919123456789');
  });

  it('accepts other countries only with a + and country code', () => {
    expect(ok('+1 415 555 0123')).toBe('+14155550123');
    expect(ok('+44 20 7946 0958')).toBe('+442079460958');
    expect(ok('+971501234567')).toBe('+971501234567');
    expect(reason('14155550123')).toBe(
      'phone has 11 digits (numbers from other countries must start with + and the country code)',
    );
  });

  it('explains what is wrong with the digit count', () => {
    expect(reason('987654321')).toBe('phone has 9 digits');
    expect(reason(987654321)).toBe('phone has 9 digits');
    expect(reason('+91987654321')).toBe('phone has 9 digits after +91');
    expect(reason('+9198765432100')).toBe('phone has 11 digits after +91');
    expect(reason('0987654321')).toMatch(/must start with 6, 7, 8 or 9/); // 0 + only 9 digits
  });

  it('rejects Indian numbers that are not mobiles', () => {
    expect(reason('1234567890')).toMatch(/must start with 6, 7, 8 or 9/);
    expect(reason('+915123456789')).toMatch(/must start with 6, 7, 8 or 9/);
  });

  it('rejects empty, lettered and malformed input', () => {
    expect(reason('')).toBe('phone is missing');
    expect(reason(null)).toBe('phone is missing');
    expect(reason(undefined)).toBe('phone is missing');
    expect(reason('   ')).toBe('phone is missing');
    expect(reason('98765abcde')).toBe('phone contains letters or symbols');
    expect(reason('9876543210.5')).toBe('phone contains letters or symbols');
    expect(reason('98765+43210')).toBe('phone contains letters or symbols');
    expect(reason('+0123456789')).toBe('phone is not a valid international number');
    expect(reason('+1234')).toBe('phone is not a valid international number');
    expect(reason('+1234567890123456')).toBe('phone is not a valid international number');
  });
});

describe('maskPhone', () => {
  it('shows only the last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('••••••3210');
    expect(maskPhone('+919876543210')).not.toContain('98765');
  });
});

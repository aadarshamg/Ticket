export type PhoneResult = { ok: true; value: string } | { ok: false; reason: string };

const fail = (reason: string): PhoneResult => ({ ok: false, reason });

function indianMobile(national: string, afterPrefix: boolean): PhoneResult {
  if (national.length !== 10) {
    return fail(`phone has ${national.length} digits${afterPrefix ? ' after +91' : ''}`);
  }
  if (!/^[6-9]/.test(national)) {
    return fail('phone is not an Indian mobile number (must start with 6, 7, 8 or 9)');
  }
  return { ok: true, value: `+91${national}` };
}

/**
 * Normalises a phone number to E.164.
 *
 * A 10-digit Indian mobile becomes +91XXXXXXXXXX; the prefixes +91, 91 and 0 are accepted,
 * as are spaces, dashes and brackets. Numbers from other countries must start with "+" and
 * the country code. Spreadsheet cells often arrive as numbers, so those are accepted too.
 */
export function normalisePhone(input: unknown): PhoneResult {
  const text = (typeof input === 'number' && Number.isFinite(input) ? String(input) : String(input ?? '')).trim();
  if (!text) return fail('phone is missing');

  // spaces (incl. non-breaking), hyphens/dashes and brackets are separators
  const compact = text.replace(/[\s \-‐-―()]/g, '');
  const hasPlus = compact.startsWith('+');
  const digits = hasPlus ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return fail('phone contains letters or symbols');

  if (hasPlus) {
    if (digits.startsWith('91')) return indianMobile(digits.slice(2), true);
    if (digits.startsWith('0') || digits.length < 8 || digits.length > 15) {
      return fail('phone is not a valid international number');
    }
    return { ok: true, value: `+${digits}` };
  }

  if (digits.length === 11 && digits.startsWith('0')) return indianMobile(digits.slice(1), false);
  if (digits.length === 12 && digits.startsWith('91')) return indianMobile(digits.slice(2), false);
  if (digits.length > 10) {
    return fail(
      `phone has ${digits.length} digits (numbers from other countries must start with + and the country code)`,
    );
  }
  return indianMobile(digits, false);
}

/** "+919876543210" -> "••••••3210". For anything shown outside the admin area. */
export function maskPhone(phone: string): string {
  return `••••••${phone.slice(-4)}`;
}

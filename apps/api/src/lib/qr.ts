import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/** HMAC-SHA256 truncated to 128 bits: far beyond guessing, and keeps the QR code small. */
const SIGNATURE_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{22}$/; // 16 bytes in base64url

function signature(passId: string): Buffer {
  return createHmac('sha256', env.QR_SECRET).update(passId).digest().subarray(0, SIGNATURE_BYTES);
}

/**
 * The text inside a pass's QR code: `<passId>.<signature>`.
 * It carries no order ID, name or phone number, only the random pass ID and its signature.
 */
export function signPass(passId: string): string {
  return `${passId}.${signature(passId).toString('base64url')}`;
}

/** Returns the pass ID if `qr` is a correctly signed pass QR, otherwise null. */
export function verifyQr(qr: unknown): string | null {
  if (typeof qr !== 'string' || qr.length > 100) return null;
  const dot = qr.indexOf('.');
  if (dot < 0) return null;
  const passId = qr.slice(0, dot);
  const given = qr.slice(dot + 1);
  if (!UUID.test(passId) || !SIGNATURE.test(given)) return null;

  const givenBytes = Buffer.from(given, 'base64url');
  // Reject non-canonical encodings so each pass has exactly one valid QR string.
  if (givenBytes.length !== SIGNATURE_BYTES || givenBytes.toString('base64url') !== given) return null;
  return timingSafeEqual(givenBytes, signature(passId)) ? passId : null;
}

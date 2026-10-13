import { headers } from 'next/headers';

// Server-side only: used by the /b/[code] and /p/[code] pages to load pass data from the API.

const API_URL = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const CODE = /^[2-9A-HJ-NP-Z]{12}$/;

export type PassStatus = 'valid' | 'used' | 'cancelled';

export interface PublicEvent {
  name: string;
  organiserName: string;
  venue: string;
  city: string;
  startsAt: string;
  gatesOpenAt: string;
  endsAt: string;
  logoUrl: string | null;
  brandColour: string;
  helplineNumber: string | null;
  termsText: string;
  /** True once the event's end time has passed. */
  over: boolean;
}

export interface PublicPass {
  passNo: number;
  status: PassStatus;
  usedAt: string | null;
  usedGate: string | null;
  /** Text to encode in the QR code; null when the pass can no longer be used. */
  qr: string | null;
}

export interface BookingView {
  event: PublicEvent;
  booking: {
    orderId: string;
    firstName: string;
    category: string | null;
    status: 'active' | 'cancelled';
    passCount: number;
    usedCount: number;
  };
  passes: (PublicPass & { shareUrl: string })[];
}

export interface PassView {
  event: PublicEvent;
  pass: PublicPass & { passCount: number; category: string | null };
}

async function load<T>(path: string): Promise<T | null> {
  // Pass the visitor's address on so the API can rate-limit guessing per visitor, not per server.
  const forwardedFor = (await headers()).get('x-forwarded-for');
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store', // entry status must always be current
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Pass API responded ${res.status}`);
  return (await res.json()) as T;
}

/** A code from the URL, upper-cased; null if it cannot be a real code. */
function parseCode(raw: string): string | null {
  const code = decodeURIComponent(raw).trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export async function fetchBooking(rawCode: string): Promise<BookingView | null> {
  const code = parseCode(rawCode);
  return code ? load<BookingView>(`/api/public/bookings/${code}`) : null;
}

export async function fetchPass(rawCode: string): Promise<PassView | null> {
  const code = parseCode(rawCode);
  return code ? load<PassView>(`/api/public/passes/${code}`) : null;
}

import type { Event, Pass, TicketStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db';
import { bookingTimes, nightFromDb } from '../lib/nights';
import { signPass } from '../lib/qr';

// What the public pass pages may see. Deliberately narrow: no phone, email, internal IDs,
// and (for a single pass) nothing about the buyer or the rest of the booking.

const CODE = /^[2-9A-HJ-NP-Z]{12}$/;

/** Normalises a code from a URL; null if it cannot be a real code (so no database lookup is needed). */
export function parseCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/**
 * The event as one booking sees it. On a multi-night event the date and times are those of the
 * booking's own night, and "over" means that night is over: its QR codes are no longer shown.
 */
function eventView(event: Event, night: Date | null) {
  const times = bookingTimes(event, nightFromDb(night));
  const over = Date.now() > times.endsAt.getTime();
  return {
    name: event.name,
    organiserName: event.organiserName,
    venue: event.venue,
    city: event.city,
    startsAt: times.startsAt,
    gatesOpenAt: times.gatesOpenAt,
    endsAt: times.endsAt,
    logoUrl: event.logoUrl,
    brandColour: event.brandColour,
    helplineNumber: event.helplineNumber,
    termsText: event.termsText,
    over,
  };
}

type PassFields = Pick<Pass, 'id' | 'passNo' | 'status' | 'usedAt' | 'usedGate'>;

function passView(pass: PassFields, ticketStatus: TicketStatus, over: boolean) {
  const cancelled = pass.status === 'cancelled' || (ticketStatus === 'cancelled' && pass.status !== 'used');
  return {
    passNo: pass.passNo,
    status: cancelled ? ('cancelled' as const) : pass.status,
    usedAt: pass.usedAt,
    usedGate: pass.usedGate,
    // No QR once the event is over or the pass is cancelled.
    qr: over || cancelled ? null : signPass(pass.id),
  };
}

/** Data for /b/{code}: the booking and all of its passes. */
export async function getBookingView(code: string) {
  const [event, ticket] = await Promise.all([
    prisma.event.findUnique({ where: { id: 1 } }),
    prisma.ticket.findUnique({
      where: { code },
      select: {
        orderId: true,
        name: true,
        category: true,
        night: true,
        status: true,
        passCount: true,
        passes: {
          select: { id: true, passNo: true, code: true, status: true, usedAt: true, usedGate: true },
          orderBy: { passNo: 'asc' },
        },
      },
    }),
  ]);
  if (!event || !ticket) return null;

  const view = eventView(event, ticket.night);
  const { over } = view;
  return {
    event: view,
    booking: {
      orderId: ticket.orderId,
      firstName: ticket.name.trim().split(/\s+/)[0] ?? '',
      category: ticket.category,
      status: ticket.status,
      passCount: ticket.passes.length,
      usedCount: ticket.passes.filter((pass) => pass.status === 'used').length,
    },
    passes: ticket.passes.map((pass) => ({
      ...passView(pass, ticket.status, over),
      /** Link to this pass alone, for forwarding to one person in the group. */
      shareUrl: `${env.PUBLIC_BASE_URL}/p/${pass.code}`,
    })),
  };
}

/** Data for /p/{code}: one pass, with nothing that identifies the buyer or the booking. */
export async function getPassView(code: string) {
  const [event, pass] = await Promise.all([
    prisma.event.findUnique({ where: { id: 1 } }),
    prisma.pass.findUnique({
      where: { code },
      select: {
        id: true,
        passNo: true,
        status: true,
        usedAt: true,
        usedGate: true,
        ticket: { select: { status: true, category: true, night: true, _count: { select: { passes: true } } } },
      },
    }),
  ]);
  if (!event || !pass) return null;

  const view = eventView(event, pass.ticket.night);
  const { over } = view;
  return {
    event: view,
    pass: {
      ...passView(pass, pass.ticket.status, over),
      passCount: pass.ticket._count.passes,
      category: pass.ticket.category,
    },
  };
}

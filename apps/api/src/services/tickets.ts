import type { Prisma } from '@prisma/client';
import { TICKET_TEMPLATE } from '../config/constants';
import { prisma, TX_OPTIONS } from '../db';
import { audit, type Actor } from '../lib/audit';
import { CODE_ALPHABET, generateCode } from '../lib/codes';
import { eventNights, nightFromDb, nightLabel, nightToDb } from '../lib/nights';
import { normalisePhone } from '../lib/phone';
import { HttpError } from '../middleware/errors';
import type { TicketCreate, TicketListQuery, TicketPatch } from '../schemas/ticket';
import { applyPassChanges, planPassCountChange } from './passes';

const listInclude = {
  messages: { where: { template: TICKET_TEMPLATE }, select: { status: true, errorText: true } },
  _count: { select: { passes: { where: { status: 'used' } } } },
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof listInclude }>;

function toListItem(ticket: TicketRow) {
  const message = ticket.messages[0];
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    code: ticket.code,
    name: ticket.name,
    phone: ticket.phone,
    email: ticket.email,
    passCount: ticket.passCount,
    usedCount: ticket._count.passes,
    amount: ticket.amount?.toFixed(2) ?? null,
    category: ticket.category,
    night: nightFromDb(ticket.night),
    status: ticket.status,
    messageStatus: message?.status ?? 'unsent',
    messageError: message?.errorText ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function buildWhere(query: TicketListQuery): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [];

  if (query.q) {
    const text = query.q;
    const or: Prisma.TicketWhereInput[] = [
      { name: { contains: text, mode: 'insensitive' } },
      { orderId: { contains: text, mode: 'insensitive' } },
      { email: { contains: text, mode: 'insensitive' } },
    ];
    // Only treat the search as a phone number when it looks like one; otherwise the digits of
    // an order ID such as "ORD-00042" would also match unrelated phone numbers.
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 3 && /^[+\d\s()-]+$/.test(text)) or.push({ phone: { contains: digits } });
    and.push({ OR: or });
  }

  if (query.status) and.push({ status: query.status });

  if (query.messageStatus === 'unsent') {
    and.push({ messages: { none: { template: TICKET_TEMPLATE } } });
  } else if (query.messageStatus) {
    and.push({ messages: { some: { template: TICKET_TEMPLATE, status: query.messageStatus } } });
  }

  // none = nobody entered; partial = some entered, some still to come; full = everyone entered
  if (query.entryStatus === 'none') {
    and.push({ passes: { none: { status: 'used' } } });
  } else if (query.entryStatus === 'partial') {
    and.push({ passes: { some: { status: 'used' } } }, { passes: { some: { status: 'valid' } } });
  } else if (query.entryStatus === 'full') {
    and.push({ passes: { some: { status: 'used' } } }, { passes: { none: { status: 'valid' } } });
  }

  return and.length > 0 ? { AND: and } : {};
}

export async function listTickets(query: TicketListQuery) {
  const where = buildWhere(query);
  const [total, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: listInclude,
      orderBy: [{ createdAt: 'desc' }, { orderId: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: tickets.map(toListItem), total, page: query.page, pageSize: query.pageSize };
}

const fieldError = (status: number, path: string, message: string) =>
  new HttpError(status, 'validation_error', 'Some fields are invalid', [{ path, message }]);

/** Edits a booking's name, phone or pass count, or cancels / restores it. */
export async function updateTicket(id: string, patch: TicketPatch, actor: Actor) {
  let phone: string | undefined;
  if (patch.phone !== undefined) {
    const normalised = normalisePhone(patch.phone);
    if (!normalised.ok) throw fieldError(400, 'phone', normalised.reason);
    phone = normalised.value;
  }

  await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id },
      include: { passes: { select: { id: true, passNo: true, status: true } } },
    });
    if (!ticket) throw new HttpError(404, 'not_found', 'Booking not found');

    const data: Prisma.TicketUpdateInput = {};
    const changes: string[] = [];
    if (patch.name !== undefined && patch.name !== ticket.name) {
      data.name = patch.name;
      changes.push('name');
    }
    if (phone !== undefined && phone !== ticket.phone) {
      data.phone = phone;
      changes.push('phone');
    }

    const status = patch.status ?? ticket.status;

    if (patch.night !== undefined && patch.night !== nightFromDb(ticket.night)) {
      const event = await tx.event.findUnique({ where: { id: 1 } });
      const nights = event ? eventNights(event) : [];
      if (!nights.includes(patch.night)) throw fieldError(400, 'night', "Not one of the event's nights");
      data.night = nightToDb(patch.night);
      changes.push('night');
    }

    if (patch.passCount !== undefined && patch.passCount !== ticket.passCount) {
      const event = await tx.event.findUnique({ where: { id: 1 }, select: { maxPassesPerBooking: true } });
      const max = event?.maxPassesPerBooking ?? 10;
      if (patch.passCount > max) throw fieldError(400, 'passCount', `Must be at most ${max}`);

      const planned = planPassCountChange(ticket.passes, patch.passCount);
      if (!planned.ok) throw fieldError(409, 'passCount', planned.reason);
      await applyPassChanges(tx, {
        remove: planned.plan.remove,
        renumber: planned.plan.renumber,
        add: planned.plan.add.map((passNo) => ({
          ticketId: ticket.id,
          passNo,
          status: status === 'cancelled' ? 'cancelled' : 'valid',
        })),
      });
      data.passCount = patch.passCount;
      changes.push(`passes ${ticket.passCount} → ${patch.passCount}`);
    }

    if (status !== ticket.status) {
      data.status = status;
      // Used passes are history and stay used either way.
      await tx.pass.updateMany({
        where: { ticketId: ticket.id, status: status === 'cancelled' ? 'valid' : 'cancelled' },
        data: { status: status === 'cancelled' ? 'cancelled' : 'valid' },
      });
      await audit(tx, actor, status === 'cancelled' ? 'ticket.cancel' : 'ticket.restore', {
        type: 'Ticket',
        id: ticket.id,
      }, { orderId: ticket.orderId });
    }

    if (Object.keys(data).length === 0) return;
    await tx.ticket.update({ where: { id: ticket.id }, data });
    if (changes.length > 0) {
      await audit(tx, actor, 'ticket.update', { type: 'Ticket', id: ticket.id }, {
        via: 'admin',
        orderId: ticket.orderId,
        changes,
      });
    }
  }, TX_OPTIONS);

  const updated = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: listInclude });
  return toListItem(updated);
}

/** Made-up order ID for a booking added by hand without one, e.g. ADD-7KQ2M. */
function manualOrderId(): string {
  return `ADD-${Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')}`;
}

/** Adds one booking by hand (a guest who is not in an uploaded list), with its passes. */
export async function createTicket(input: TicketCreate, actor: Actor) {
  if (!actor.id) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  const phone = normalisePhone(input.phone);
  if (!phone.ok) throw fieldError(400, 'phone', phone.reason);

  const event = await prisma.event.findUnique({ where: { id: 1 } });
  if (!event) throw new HttpError(409, 'event_not_configured', 'Set up the event in Settings first.');
  if (input.passCount > event.maxPassesPerBooking) {
    throw fieldError(400, 'passCount', `Must be at most ${event.maxPassesPerBooking} (Settings > Max passes per booking)`);
  }
  const nights = eventNights(event);
  const night = input.night || null;
  if (night && !nights.includes(night)) throw fieldError(400, 'night', "Not one of the event's nights");
  if (!night && nights.length > 1) {
    throw fieldError(400, 'night', `Choose the night: ${nights.map(nightLabel).join(' or ')}`);
  }

  let orderId = input.orderId || '';
  if (orderId) {
    if (await prisma.ticket.findUnique({ where: { orderId }, select: { id: true } })) {
      throw fieldError(409, 'orderId', 'Another booking already has this order ID');
    }
  } else {
    do orderId = manualOrderId();
    while (await prisma.ticket.findUnique({ where: { orderId }, select: { id: true } }));
  }

  const created = await prisma.$transaction(async (tx) => {
    // Every booking belongs to an upload; hand-added ones share one per admin.
    const fileName = 'Added in the dashboard';
    const upload =
      (await tx.upload.findFirst({ where: { fileName, uploadedById: actor.id as string } })) ??
      (await tx.upload.create({
        data: { fileName, uploadedById: actor.id as string, rowCount: 0, validCount: 0, errorCount: 0, status: 'confirmed', confirmedAt: new Date() },
      }));
    const ticket = await tx.ticket.create({
      data: {
        orderId,
        code: generateCode(),
        name: input.name,
        phone: phone.value,
        email: input.email || null,
        passCount: input.passCount,
        category: input.category || null,
        night: nightToDb(night),
        uploadId: upload.id,
      },
    });
    await applyPassChanges(tx, {
      remove: [],
      renumber: [],
      add: Array.from({ length: input.passCount }, (_, index) => ({ ticketId: ticket.id, passNo: index + 1, status: 'valid' as const })),
    });
    await audit(tx, actor, 'ticket.create', { type: 'Ticket', id: ticket.id }, { via: 'admin', orderId, passes: input.passCount });
    return ticket;
  }, TX_OPTIONS);

  return toListItem(await prisma.ticket.findUniqueOrThrow({ where: { id: created.id }, include: listInclude }));
}

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TICKET_TEMPLATE } from '../config/constants';
import { prisma } from '../db';
import { audit, type Actor } from '../lib/audit';
import { eventNights, nightTimes, nightToDb, type EventTimes } from '../lib/nights';
import { normalisePhone } from '../lib/phone';
import { getMessaging, getMessagingIfConfigured, getSender } from '../messaging';
import { buildTicketMessage, REMINDER_TEMPLATE } from '../messaging/templates';
import { HttpError } from '../middleware/errors';

export type SendMode = 'unsent' | 'failed' | 'selected' | 'reminder';

export interface SendRequest {
  /**
   * unsent   – bookings that have never been sent their passes
   * failed   – bookings whose pass message failed
   * selected – the given bookings (resends if already sent)
   * reminder – event_reminder_v1 to bookings that still have unused passes
   */
  mode: SendMode;
  ticketIds?: string[];
  /** Send to at most this many bookings (oldest first), e.g. a first batch of 100. */
  limit?: number;
}

/** Arbitrary constant; stops two simultaneous "send" clicks from queueing the same booking twice. */
const SEND_LOCK = Prisma.raw('7426002');

function selection(request: SendRequest, template: string, pastNights: Date[]): Prisma.TicketWhereInput {
  const notAlreadyQueued: Prisma.TicketWhereInput = { messages: { none: { template, status: 'queued' } } };
  // No reminders for a night that is already over.
  const nightNotOver: Prisma.TicketWhereInput =
    pastNights.length > 0 ? { OR: [{ night: null }, { night: { notIn: pastNights } }] } : {};
  switch (request.mode) {
    case 'unsent':
      return { status: 'active', messages: { none: { template } } };
    case 'failed':
      return { status: 'active', messages: { some: { template, status: 'failed' } } };
    case 'selected':
      return { status: 'active', id: { in: request.ticketIds ?? [] }, ...notAlreadyQueued };
    case 'reminder':
      return { status: 'active', passes: { some: { status: 'valid' } }, ...notAlreadyQueued, ...nightNotOver };
  }
}

/** Nights of the event whose end has passed, as stored in Ticket.night. */
function pastNightsOf(event: EventTimes): Date[] {
  return eventNights(event)
    .filter((night) => nightTimes(event, night).endsAt.getTime() < Date.now())
    .map((night) => nightToDb(night) as Date);
}

/** Marks the chosen bookings' messages as queued and hands them to the send queue. */
export async function queueSend(request: SendRequest, actor: Actor) {
  const messaging = getMessaging();
  try {
    await messaging.ping();
  } catch {
    throw new HttpError(503, 'queue_unavailable', 'The send queue (Redis) cannot be reached. Nothing was queued.');
  }

  const event = await prisma.event.findUnique({ where: { id: 1 }, select: { startsAt: true, gatesOpenAt: true, endsAt: true } });
  if (!event) throw new HttpError(409, 'event_not_configured', 'Set up the event in Settings before sending.');
  if (Date.now() > event.endsAt.getTime()) throw new HttpError(409, 'event_over', 'The event is over.');

  const template = request.mode === 'reminder' ? REMINDER_TEMPLATE : TICKET_TEMPLATE;
  if (messaging.sender.canSend?.(template) === false) {
    throw new HttpError(409, 'template_not_configured', `WhatsApp is not set up for the ${template} message yet. Nothing was queued.`);
  }
  const batchId = randomUUID();
  const pastNights = pastNightsOf(event);

  const messageIds = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEND_LOCK})`;

      const tickets = await tx.ticket.findMany({
        where: selection(request, template, pastNights),
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { orderId: 'asc' }],
        take: request.limit,
      });
      if (tickets.length === 0) return [];
      const ticketIds = tickets.map((ticket) => ticket.id);

      // One Message row per booking per template: reset it if it exists, create it if not.
      await tx.message.updateMany({
        where: { ticketId: { in: ticketIds }, template },
        data: { status: 'queued', waMessageId: null, errorCode: null, errorText: null },
      });
      await tx.message.createMany({
        data: ticketIds.map((ticketId) => ({ ticketId, template, status: 'queued' as const })),
        skipDuplicates: true,
      });
      const messages = await tx.message.findMany({
        where: { ticketId: { in: ticketIds }, template },
        select: { id: true },
      });

      await audit(tx, actor, 'send.queue', undefined, {
        mode: request.mode,
        template,
        batchId,
        count: messages.length,
        ...(request.limit ? { limit: request.limit } : {}),
      });
      return messages.map((message) => message.id);
    },
    { maxWait: 15_000, timeout: 60_000 },
  );

  try {
    await messaging.enqueue(messageIds, batchId);
  } catch (error) {
    // Do not leave rows stuck as "queued" with no job behind them.
    await prisma.message.updateMany({
      where: { id: { in: messageIds }, status: 'queued' },
      data: { status: 'failed', errorCode: 'queue_error', errorText: 'Could not be added to the send queue' },
    });
    console.error('Enqueue failed:', error);
    throw new HttpError(503, 'queue_unavailable', 'The send queue failed. Use "Resend failed" to try again.');
  }

  return { batchId, template, queued: messageIds.length };
}

/** Sends (or resends) the pass message for one booking. */
export async function resendTicket(ticketId: string, actor: Actor) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true, messages: { where: { template: TICKET_TEMPLATE }, select: { status: true } } },
  });
  if (!ticket) throw new HttpError(404, 'not_found', 'Booking not found');
  if (ticket.status === 'cancelled') throw new HttpError(409, 'cancelled', 'This booking is cancelled.');
  if (ticket.messages[0]?.status === 'queued') {
    throw new HttpError(409, 'already_queued', 'A message for this booking is already waiting to be sent.');
  }
  return queueSend({ mode: 'selected', ticketIds: [ticketId] }, actor);
}

/**
 * Sends one booking's real pass message to the organiser's own numbers, to check how it
 * looks before sending to buyers. Goes out immediately; the booking is not marked as sent.
 */
export async function sendTest(phones: string[], ticketId: string | undefined, actor: Actor) {
  const numbers = phones.map((raw) => ({ raw, parsed: normalisePhone(raw) }));
  const invalid = numbers.find((n) => !n.parsed.ok);
  if (invalid && !invalid.parsed.ok) {
    throw new HttpError(400, 'validation_error', 'Some fields are invalid', [
      { path: 'phones', message: `${invalid.raw}: ${invalid.parsed.reason}` },
    ]);
  }

  const [event, ticket] = await Promise.all([
    prisma.event.findUnique({ where: { id: 1 } }),
    ticketId
      ? prisma.ticket.findUnique({ where: { id: ticketId } })
      : prisma.ticket.findFirst({ where: { status: 'active' }, orderBy: [{ createdAt: 'asc' }, { orderId: 'asc' }] }),
  ]);
  if (!event) throw new HttpError(409, 'event_not_configured', 'Set up the event in Settings before sending.');
  if (!ticket) throw new HttpError(409, 'no_bookings', 'Upload at least one booking to send a test message.');

  const sender = getSender();
  const message = buildTicketMessage(event, ticket);
  const results = [];
  for (const { raw, parsed } of numbers) {
    if (!parsed.ok) continue;
    const result = await sender.send({ ...message, to: parsed.value }).catch(
      (error: unknown) =>
        ({ ok: false, retryable: false, errorCode: 'sender_error', errorText: error instanceof Error ? error.message : 'Unknown error' }) as const,
    );
    results.push({ phone: raw, ok: result.ok, error: result.ok ? null : `${result.errorText} (${result.errorCode})` });
  }
  await audit(prisma, actor, 'send.test', { type: 'Ticket', id: ticket.id }, {
    recipients: results.length,
    failed: results.filter((r) => !r.ok).length,
  });
  return { sender: sender.name, orderId: ticket.orderId, results };
}

export async function pauseSending(actor: Actor) {
  await getMessaging().pause('manual');
  await audit(prisma, actor, 'send.pause');
  return getSendStatus();
}

export async function resumeSending(actor: Actor) {
  await getMessaging().resume();
  await audit(prisma, actor, 'send.resume');
  return getSendStatus();
}

/** Everything the send panel shows: totals by message status, and the state of the queue. */
export async function getSendStatus() {
  const [byStatus, unsent, reminderCandidates] = await Promise.all([
    prisma.message.groupBy({ by: ['status'], where: { template: TICKET_TEMPLATE }, _count: true }),
    prisma.ticket.count({ where: { status: 'active', messages: { none: { template: TICKET_TEMPLATE } } } }),
    prisma.ticket.count({ where: { status: 'active', passes: { some: { status: 'valid' } } } }),
  ]);
  const counts = { unsent, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of byStatus) counts[row.status] = row._count;

  let queue = null;
  let configured = true;
  let problem: string | null = null;
  const messaging = getMessagingIfConfigured();
  if (!messaging) {
    configured = false;
    problem = 'Sending is not set up on the server (REDIS_URL or WhatsApp settings are missing).';
  } else {
    try {
      queue = await messaging.status();
    } catch {
      problem = 'The send queue (Redis) cannot be reached.';
    }
  }
  return { configured, problem, sender: messaging?.sender.name ?? null, counts, reminderCandidates, queue };
}

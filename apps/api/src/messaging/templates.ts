import type { Event, Prisma } from '@prisma/client';
import { TICKET_TEMPLATE } from '../config/constants';
import { formatIstDate, formatIstTime } from '../lib/time';
import type { OutboundMessage } from './types';

export const REMINDER_TEMPLATE = 'event_reminder_v1';
export const TEMPLATE_LANGUAGE = 'en';

export interface MessageTicket {
  name: string;
  phone: string;
  orderId: string;
  code: string;
  passCount: number;
  amount: Prisma.Decimal | null;
}

/** WhatsApp rejects template values containing new lines, tabs or runs of more than four spaces. */
export function cleanParam(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** "3196.00" -> "3,196"; "1598.50" -> "1,598.5"; no amount -> "-". */
export function formatAmount(amount: Prisma.Decimal | null): string {
  if (amount === null) return '-';
  return Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * event_ticket_v1 body variables:
 * 1 name · 2 event name · 3 date with weekday · 4 start time (24h) · 5 venue, city ·
 * 6 number of passes · 7 amount · 8 order ID · 9 organiser name
 */
export function buildTicketMessage(event: Event, ticket: MessageTicket): OutboundMessage {
  return {
    to: ticket.phone,
    template: TICKET_TEMPLATE,
    language: TEMPLATE_LANGUAGE,
    bodyParams: [
      ticket.name,
      event.name,
      formatIstDate(event.startsAt),
      formatIstTime(event.startsAt),
      `${event.venue}, ${event.city}`,
      String(ticket.passCount),
      formatAmount(ticket.amount),
      ticket.orderId,
      event.organiserName,
    ].map(cleanParam),
    buttonUrlSuffix: ticket.code,
  };
}

/**
 * event_reminder_v1 body variables:
 * 1 name · 2 event name · 3 date with weekday · 4 start time (24h) · 5 venue, city ·
 * 6 gates-open time (24h) · 7 passes not yet used · 8 organiser name
 */
export function buildReminderMessage(event: Event, ticket: MessageTicket, unusedPasses: number): OutboundMessage {
  return {
    to: ticket.phone,
    template: REMINDER_TEMPLATE,
    language: TEMPLATE_LANGUAGE,
    bodyParams: [
      ticket.name,
      event.name,
      formatIstDate(event.startsAt),
      formatIstTime(event.startsAt),
      `${event.venue}, ${event.city}`,
      formatIstTime(event.gatesOpenAt),
      String(unusedPasses),
      event.organiserName,
    ].map(cleanParam),
    buttonUrlSuffix: ticket.code,
  };
}

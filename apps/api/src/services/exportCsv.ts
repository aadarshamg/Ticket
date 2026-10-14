import { TICKET_TEMPLATE } from '../config/constants';
import { prisma } from '../db';
import { nightFromDb } from '../lib/nights';
import { formatIstDate, formatIstTime } from '../lib/time';

/**
 * One CSV cell. Quotes anything containing a comma, quote or line break, and defuses
 * "formula injection": a booking named `=HYPERLINK(...)` must open in Excel as text, not
 * as a formula, so cells starting with = + - @ (or a tab/CR) get a leading apostrophe.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // A plain number such as a phone (+919876543210) or -5 cannot be a formula; leave it readable.
  const plainNumber = /^[+-]?\d+(\.\d+)?$/.test(text);
  if (typeof value === 'string' && !plainNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const istDateTime = (date: Date | null | undefined) => (date ? `${formatIstDate(date)} ${formatIstTime(date)}` : '');

export const EXPORT_COLUMNS = [
  'order_id',
  'name',
  'phone',
  'email',
  'category',
  'night',
  'amount',
  'passes',
  'passes_used',
  'passes_remaining',
  'booking_status',
  'message_status',
  'message_error',
  'first_entry_ist',
  'last_entry_ist',
  'gates',
] as const;

/** Every booking with its WhatsApp message status and how many of its passes were used. */
export async function buildExportCsv(): Promise<{ csv: string; rows: number }> {
  const tickets = await prisma.ticket.findMany({
    orderBy: [{ createdAt: 'asc' }, { orderId: 'asc' }],
    select: {
      orderId: true,
      name: true,
      phone: true,
      email: true,
      category: true,
      night: true,
      amount: true,
      passCount: true,
      status: true,
      messages: { where: { template: TICKET_TEMPLATE }, select: { status: true, errorText: true } },
      passes: { select: { status: true, usedAt: true, usedGate: true } },
    },
  });

  const lines = [EXPORT_COLUMNS.join(',')];
  for (const ticket of tickets) {
    const used = ticket.passes.filter((pass) => pass.status === 'used');
    const entryTimes = used.flatMap((pass) => (pass.usedAt ? [pass.usedAt.getTime()] : []));
    const gates = [...new Set(used.flatMap((pass) => (pass.usedGate ? [pass.usedGate] : [])))].sort();
    const message = ticket.messages[0];
    lines.push(
      [
        ticket.orderId,
        ticket.name,
        ticket.phone,
        ticket.email,
        ticket.category,
        nightFromDb(ticket.night),
        ticket.amount?.toFixed(2) ?? null,
        ticket.passes.length,
        used.length,
        ticket.passes.filter((pass) => pass.status === 'valid').length,
        ticket.status,
        message?.status ?? 'unsent',
        message?.errorText ?? null,
        entryTimes.length > 0 ? istDateTime(new Date(Math.min(...entryTimes))) : null,
        entryTimes.length > 0 ? istDateTime(new Date(Math.max(...entryTimes))) : null,
        gates.join('; '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // A byte-order mark makes Excel read the file as UTF-8 (names in Indian scripts survive).
  return { csv: `﻿${lines.join('\r\n')}\r\n`, rows: tickets.length };
}

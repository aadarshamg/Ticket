import type { Prisma, TicketStatus } from '@prisma/client';
import { nightFromDb, nightLabel } from '../../lib/nights';
import { planPassCountChange, type PassPlan, type PassRef } from '../passes';
import type { ColumnName } from './parseSheet';
import type { RowData } from './validateRows';

export interface ExistingTicket {
  id: string;
  orderId: string;
  name: string;
  phone: string;
  email: string | null;
  passCount: number;
  amount: Prisma.Decimal | null;
  category: string | null;
  night: Date | null;
  status: TicketStatus;
  passes: PassRef[];
}

/** What to select from Ticket to get an ExistingTicket. */
export const existingTicketSelect = {
  id: true,
  orderId: true,
  name: true,
  phone: true,
  email: true,
  passCount: true,
  amount: true,
  category: true,
  night: true,
  status: true,
  passes: { select: { id: true, passNo: true, status: true } },
} as const;

export type RowAction = 'create' | 'update' | 'unchanged';

export type Classification =
  | {
      ok: true;
      action: RowAction;
      /** Human-readable list of what an update changes, e.g. ["phone", "passes 4 → 2"]. */
      changes: string[];
      notes: string[];
      /** The values to store: the row, with absent optional columns kept from the booking. */
      data: RowData;
      passPlan: PassPlan | null;
    }
  | { ok: false; reason: string };

const sameAmount = (a: Prisma.Decimal | null, b: string | null) =>
  a === null || b === null ? a === null && b === null : Number(a) === Number(b);

/**
 * Decides what a valid spreadsheet row does to the database: create a booking, update the one
 * with the same order ID, or nothing. An optional column that is absent from the file leaves
 * the stored value alone; one that is present but blank clears it. Pure function.
 */
export function classifyRow(
  row: RowData,
  existing: ExistingTicket | undefined,
  presentColumns: ReadonlySet<ColumnName>,
  /** The event's nights. With more than one, every booking must say which night it is for. */
  nights: readonly string[] = [],
): Classification {
  if (!existing) {
    if (nights.length > 1 && !row.night) {
      return { ok: false, reason: `night is missing: add a night column (${nights.map(nightLabel).join(' or ')})` };
    }
    return { ok: true, action: 'create', changes: [], notes: [], data: row, passPlan: null };
  }

  const data: RowData = {
    ...row,
    email: presentColumns.has('email') ? row.email : existing.email,
    amount: presentColumns.has('amount') ? row.amount : (existing.amount?.toFixed(2) ?? null),
    category: presentColumns.has('category') ? row.category : existing.category,
    night: presentColumns.has('night') ? row.night : nightFromDb(existing.night),
  };

  const changes: string[] = [];
  if (data.name !== existing.name) changes.push('name');
  if (data.phone !== existing.phone) changes.push('phone');
  if (data.email !== existing.email) changes.push('email');
  if (!sameAmount(existing.amount, data.amount)) changes.push('amount');
  if (data.category !== existing.category) changes.push('category');
  if (data.night !== nightFromDb(existing.night)) changes.push('night');

  let passPlan: PassPlan | null = null;
  if (data.passCount !== existing.passCount || existing.passes.length !== existing.passCount) {
    const planned = planPassCountChange(existing.passes, data.passCount);
    if (!planned.ok) return { ok: false, reason: planned.reason };
    passPlan = planned.plan;
    if (data.passCount !== existing.passCount) changes.push(`passes ${existing.passCount} → ${data.passCount}`);
  }

  const notes = existing.status === 'cancelled' ? ['This booking is cancelled and will stay cancelled'] : [];
  return {
    ok: true,
    action: changes.length > 0 || passPlan ? 'update' : 'unchanged',
    changes,
    notes,
    data,
    passPlan,
  };
}

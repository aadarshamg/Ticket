import { z } from 'zod';
import { nightLabel, parseNight } from '../../lib/nights';
import { normalisePhone } from '../../lib/phone';
import { COLUMNS, type ColumnName, type SheetRow } from './parseSheet';

/** A booking as it will be stored. `amount` is a decimal string with two places. */
export interface RowData {
  orderId: string;
  name: string;
  phone: string;
  email: string | null;
  passCount: number;
  amount: string | null;
  category: string | null;
  /** India date of the booking's night ("2026-10-17"); null when the row gives none. */
  night: string | null;
}

export interface ValidatedRow {
  row: number;
  /** Cell values as text, for showing the organiser what the file contained. */
  raw: Record<ColumnName, string>;
  /** Each message starts with "Row N: ". Empty when the row is valid. */
  errors: string[];
  data: RowData | null;
}

const MAX_AMOUNT = 99_999_999.99;
const emailSchema = z.string().email().max(254);

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function parsePasses(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const text = cellText(value);
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

/** Accepts 1200, "1,200", "₹1200.50", "Rs. 1200", "INR 1200". Returns null if not a number. */
function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cellText(value)
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/[,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

/**
 * Checks every row against the column rules. Pure: no database access.
 * `nights` are the event's nights; on a multi-night event every row that has the night column
 * must name one of them.
 */
export function validateRows(rows: SheetRow[], maxPassesPerBooking: number, nights: string[] = []): ValidatedRow[] {
  const results = rows.map(({ row, cells }): ValidatedRow => {
    const raw = Object.fromEntries(COLUMNS.map((column) => [column, cellText(cells[column])])) as Record<
      ColumnName,
      string
    >;
    const errors: string[] = [];
    const error = (message: string) => errors.push(`Row ${row}: ${message}`);

    const orderId = raw.order_id;
    if (!orderId) error('order_id is missing');
    else if (orderId.length > 64) error('order_id is longer than 64 characters');

    const name = raw.name.replace(/\s+/g, ' ');
    if (!name) error('name is missing');
    else if (name.length < 2 || name.length > 80) error('name must be 2 to 80 characters');

    const phone = normalisePhone(cells.phone);
    if (!phone.ok) error(phone.reason);

    let passCount = 0;
    if (!raw.passes) {
      error('passes is missing');
    } else {
      const parsed = parsePasses(cells.passes);
      if (parsed === null) error('passes must be a whole number');
      else if (parsed < 1 || parsed > maxPassesPerBooking) {
        error(`passes must be between 1 and ${maxPassesPerBooking}`);
      } else passCount = parsed;
    }

    let amount: string | null = null;
    if (raw.amount) {
      const parsed = parseAmount(cells.amount);
      if (parsed === null) error('amount is not a number');
      else if (parsed < 0 || parsed > MAX_AMOUNT) error('amount is out of range');
      else amount = parsed.toFixed(2);
    }

    const category = raw.category || null;
    if (category && category.length > 60) error('category is longer than 60 characters');

    const email = raw.email ? raw.email.toLowerCase() : null;
    if (email && !emailSchema.safeParse(email).success) error('email is not valid');

    let night: string | null = null;
    if (raw.night) {
      const parsed = parseNight(cells.night, nights);
      if ('error' in parsed) error(parsed.error);
      else night = parsed.night;
    } else if ('night' in cells && nights.length > 1) {
      error(`night is missing (${nights.map(nightLabel).join(' or ')})`);
    }

    const data: RowData | null =
      errors.length === 0 && phone.ok
        ? { orderId, name, phone: phone.value, email, passCount, amount, category, night }
        : null;
    return { row, raw, errors, data };
  });

  // order_id must be unique within the file. Every copy is rejected: we cannot know which is right.
  const rowsByOrderId = new Map<string, number[]>();
  for (const result of results) {
    if (!result.raw.order_id) continue;
    const list = rowsByOrderId.get(result.raw.order_id) ?? [];
    list.push(result.row);
    rowsByOrderId.set(result.raw.order_id, list);
  }
  for (const result of results) {
    const sameId = rowsByOrderId.get(result.raw.order_id);
    if (sameId && sameId.length > 1) {
      result.errors.push(
        `Row ${result.row}: order_id "${result.raw.order_id}" appears more than once (rows ${sameId.join(', ')})`,
      );
      result.data = null;
    }
  }

  return results;
}

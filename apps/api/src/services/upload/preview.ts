import path from 'node:path';
import type { Prisma, PrismaClient, Upload } from '@prisma/client';
import { UPLOAD_PREVIEW_TTL_MS } from '../../config/constants';
import { prisma, TX_OPTIONS } from '../../db';
import { audit, type Actor } from '../../lib/audit';
import { eventNights } from '../../lib/nights';
import { HttpError } from '../../middleware/errors';
import { classifyRow, existingTicketSelect, type ExistingTicket, type RowAction } from './classify';
import { parseSheet, type ColumnName } from './parseSheet';
import { validateRows, type RowData } from './validateRows';

export interface PreviewRow {
  row: number;
  valid: boolean;
  errors: string[];
  action: RowAction | null;
  changes: string[];
  notes: string[];
  raw: Record<ColumnName, string>;
  data: RowData | null;
}

/** Shape of Upload.previewRows while an upload is pending. */
export interface StoredPreview {
  presentColumns: ColumnName[];
  ignoredColumns: string[];
  rows: PreviewRow[];
}

export async function loadExistingTickets(
  db: PrismaClient | Prisma.TransactionClient,
  orderIds: string[],
): Promise<Map<string, ExistingTicket>> {
  if (orderIds.length === 0) return new Map();
  const tickets = await db.ticket.findMany({
    where: { orderId: { in: orderIds } },
    select: existingTicketSelect,
  });
  return new Map(tickets.map((ticket) => [ticket.orderId, ticket]));
}

function summarise(rows: PreviewRow[]) {
  const count = (action: RowAction) => rows.filter((row) => row.valid && row.action === action).length;
  return {
    create: count('create'),
    update: count('update'),
    unchanged: count('unchanged'),
    invalid: rows.filter((row) => !row.valid).length,
  };
}

function toResponse(upload: Upload, preview: StoredPreview | null) {
  return {
    upload: {
      id: upload.id,
      fileName: upload.fileName,
      rowCount: upload.rowCount,
      validCount: upload.validCount,
      errorCount: upload.errorCount,
      status: upload.status,
      createdAt: upload.createdAt,
      confirmedAt: upload.confirmedAt,
    },
    summary: preview ? summarise(preview.rows) : null,
    ignoredColumns: preview?.ignoredColumns ?? [],
    rows: preview?.rows ?? [],
  };
}

/**
 * Parses and checks an uploaded spreadsheet and stores the result as a pending upload.
 * No bookings are created or changed here. The file itself only ever exists in memory.
 */
export async function createPreview(file: { buffer: Buffer; originalname: string }, actor: Actor) {
  if (!actor.id) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  const event = await prisma.event.findUnique({
    where: { id: 1 },
    select: { maxPassesPerBooking: true, startsAt: true, gatesOpenAt: true, endsAt: true },
  });
  if (!event) {
    throw new HttpError(409, 'event_not_configured', 'Set up the event in Settings before uploading bookings.');
  }
  const nights = eventNights(event);

  const fileName = path.basename(file.originalname).slice(0, 200) || 'upload';
  const sheet = parseSheet(file.buffer, fileName);
  const validated = validateRows(sheet.rows, event.maxPassesPerBooking, nights);

  const orderIds = validated.flatMap((row) => (row.data ? [row.data.orderId] : []));
  const existing = await loadExistingTickets(prisma, orderIds);
  const presentColumns = new Set(sheet.presentColumns);

  const rows = validated.map((row): PreviewRow => {
    const invalid = (errors: string[]): PreviewRow => ({
      row: row.row,
      valid: false,
      errors,
      action: null,
      changes: [],
      notes: [],
      raw: row.raw,
      data: null,
    });
    if (!row.data) return invalid(row.errors);
    const result = classifyRow(row.data, existing.get(row.data.orderId), presentColumns, nights);
    if (!result.ok) return invalid([`Row ${row.row}: ${result.reason}`]);
    return {
      row: row.row,
      valid: true,
      errors: [],
      action: result.action,
      changes: result.changes,
      notes: result.notes,
      raw: row.raw,
      data: result.data,
    };
  });

  const preview: StoredPreview = {
    presentColumns: sheet.presentColumns,
    ignoredColumns: sheet.ignoredColumns,
    rows,
  };
  const validCount = rows.filter((row) => row.valid).length;

  const upload = await prisma.$transaction(async (tx) => {
    // Abandoned previews hold personal data; clear them out.
    await tx.upload.deleteMany({
      where: { status: 'pending', createdAt: { lt: new Date(Date.now() - UPLOAD_PREVIEW_TTL_MS) } },
    });
    const created = await tx.upload.create({
      data: {
        fileName,
        uploadedById: actor.id as string,
        rowCount: rows.length,
        validCount,
        errorCount: rows.length - validCount,
        previewRows: preview as unknown as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, 'upload.preview', { type: 'Upload', id: created.id }, {
      fileName,
      rows: rows.length,
      valid: validCount,
      invalid: rows.length - validCount,
    });
    return created;
  }, TX_OPTIONS);

  return toResponse(upload, preview);
}

export async function getUpload(id: string) {
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload) throw new HttpError(404, 'not_found', 'Upload not found');
  const preview = upload.status === 'pending' ? (upload.previewRows as unknown as StoredPreview | null) : null;
  return toResponse(upload, preview);
}

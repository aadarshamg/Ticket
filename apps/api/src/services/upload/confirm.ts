import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { UPLOAD_PREVIEW_TTL_MS } from '../../config/constants';
import { prisma } from '../../db';
import type { Actor } from '../../lib/audit';
import { generateUniqueCodes } from '../../lib/codes';
import { table } from '../../lib/sql';
import { HttpError } from '../../middleware/errors';
import { applyPassChanges, type PassChanges } from '../passes';
import { classifyRow, type ExistingTicket } from './classify';
import { loadExistingTickets, type StoredPreview } from './preview';
import type { RowData } from './validateRows';

export interface ConfirmResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Rows that were valid at preview but can no longer be saved (e.g. passes used since). */
  skipped: { row: number; orderId: string; reason: string }[];
  passesCreated: number;
  passesRemoved: number;
}

const CHUNK = 1000;
/** Arbitrary constant; serialises confirms so two cannot create the same order ID. */
const CONFIRM_LOCK = Prisma.raw('7426001');

/**
 * Saves the valid rows of a previewed upload: new bookings with their passes, and updates to
 * bookings whose order ID already exists. Everything happens in one transaction, in a fixed
 * number of statements regardless of file size. Rows are re-checked against the database as it
 * is now, not as it was at preview time.
 */
export async function confirmUpload(uploadId: string, actor: Actor): Promise<ConfirmResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CONFIRM_LOCK})`;

      const upload = await tx.upload.findUnique({ where: { id: uploadId } });
      if (!upload) throw new HttpError(404, 'not_found', 'Upload not found');
      if (upload.status === 'confirmed') {
        throw new HttpError(409, 'already_confirmed', 'This upload has already been saved.');
      }
      const preview = upload.previewRows as unknown as StoredPreview | null;
      if (!preview || Date.now() - upload.createdAt.getTime() > UPLOAD_PREVIEW_TTL_MS) {
        throw new HttpError(410, 'preview_expired', 'This preview has expired. Upload the file again.');
      }
      const event = await tx.event.findUnique({ where: { id: 1 }, select: { maxPassesPerBooking: true } });
      if (!event) throw new HttpError(409, 'event_not_configured', 'Set up the event in Settings first.');

      const validRows = preview.rows.filter((row) => row.valid && row.data);
      const existing = await loadExistingTickets(
        tx,
        validRows.map((row) => (row.data as RowData).orderId),
      );
      const presentColumns = new Set(preview.presentColumns);

      const result: ConfirmResult = {
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: [],
        passesCreated: 0,
        passesRemoved: 0,
      };
      const creates: RowData[] = [];
      const updates: { ticket: ExistingTicket; data: RowData; changes: string[] }[] = [];
      const passChanges: PassChanges = { remove: [], renumber: [], add: [] };

      for (const row of validRows) {
        const data = row.data as RowData;
        const skip = (reason: string) => result.skipped.push({ row: row.row, orderId: data.orderId, reason });
        if (data.passCount > event.maxPassesPerBooking) {
          skip(`passes must be between 1 and ${event.maxPassesPerBooking}`);
          continue;
        }
        const ticket = existing.get(data.orderId);
        const outcome = classifyRow(data, ticket, presentColumns);
        if (!outcome.ok) {
          skip(outcome.reason);
        } else if (outcome.action === 'create') {
          creates.push(outcome.data);
        } else if (outcome.action === 'update' && ticket) {
          updates.push({ ticket, data: outcome.data, changes: outcome.changes });
          if (outcome.passPlan) {
            passChanges.remove.push(...outcome.passPlan.remove);
            passChanges.renumber.push(...outcome.passPlan.renumber);
            const status = ticket.status === 'cancelled' ? 'cancelled' : 'valid';
            passChanges.add.push(
              ...outcome.passPlan.add.map((passNo) => ({ ticketId: ticket.id, passNo, status }) as const),
            );
          }
        } else {
          result.unchanged++;
        }
      }

      // New bookings
      const codes = generateUniqueCodes(creates.length);
      const newTickets = creates.map((data, index) => ({
        id: randomUUID(),
        code: codes[index] as string,
        uploadId,
        ...data,
      }));
      for (let i = 0; i < newTickets.length; i += CHUNK) {
        await tx.ticket.createMany({ data: newTickets.slice(i, i + CHUNK) });
      }
      for (const ticket of newTickets) {
        for (let passNo = 1; passNo <= ticket.passCount; passNo++) {
          passChanges.add.push({ ticketId: ticket.id, passNo, status: 'valid' });
        }
      }

      // Changed bookings, in one statement
      if (updates.length > 0) {
        const json = JSON.stringify(updates.map(({ ticket, data }) => ({ id: ticket.id, ...data })));
        await tx.$executeRaw`
          UPDATE ${table('Ticket')} AS t
          SET "name" = v."name", "phone" = v."phone", "email" = v."email", "passCount" = v."passCount",
              "amount" = v."amount", "category" = v."category", "uploadId" = ${uploadId}::uuid, "updatedAt" = now()
          FROM jsonb_to_recordset(${json}::jsonb)
            AS v("id" uuid, "name" text, "phone" text, "email" text, "passCount" int, "amount" numeric, "category" text)
          WHERE t."id" = v."id"`;
      }

      await applyPassChanges(tx, passChanges);

      result.created = newTickets.length;
      result.updated = updates.length;
      result.passesCreated = passChanges.add.length;
      result.passesRemoved = passChanges.remove.length;

      // Audit: one entry for the upload, one per changed booking (field names only, no values).
      const actorFields = { actorType: actor.type, actorId: actor.id, actorLabel: actor.label };
      const auditRows: Prisma.AuditLogCreateManyInput[] = updates.map(({ ticket, changes }) => ({
        ...actorFields,
        action: 'ticket.update',
        entityType: 'Ticket',
        entityId: ticket.id,
        meta: { via: 'upload', uploadId, changes },
      }));
      auditRows.push({
        ...actorFields,
        action: 'upload.confirm',
        entityType: 'Upload',
        entityId: uploadId,
        meta: {
          fileName: upload.fileName,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped.length,
          passesCreated: result.passesCreated,
          passesRemoved: result.passesRemoved,
        },
      });
      for (let i = 0; i < auditRows.length; i += CHUNK) {
        await tx.auditLog.createMany({ data: auditRows.slice(i, i + CHUNK) });
      }

      // The preview rows hold personal data and are no longer needed.
      await tx.upload.update({
        where: { id: uploadId },
        data: { status: 'confirmed', confirmedAt: new Date(), previewRows: Prisma.DbNull },
      });

      return result;
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
}

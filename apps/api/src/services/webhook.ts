import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MessageStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { getMessagingIfConfigured } from '../messaging';

/**
 * Checks Meta's X-Hub-Signature-256 header: "sha256=" + hex HMAC-SHA256 of the exact
 * request body, keyed with the app secret.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface StatusUpdate {
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
  errorText: string | null;
}

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  errors: z
    .array(
      z.object({
        code: z.union([z.number(), z.string()]).optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.object({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const payloadSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ value: z.object({ statuses: z.array(z.unknown()).optional() }).optional() })).optional(),
      }),
    )
    .optional(),
});

/** Pulls the message status updates out of a webhook payload, ignoring everything else. */
export function extractStatuses(payload: unknown): StatusUpdate[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const updates: StatusUpdate[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.statuses ?? []) {
        const status = statusSchema.safeParse(raw);
        if (!status.success) continue;
        const kind = status.data.status;
        if (kind !== 'sent' && kind !== 'delivered' && kind !== 'read' && kind !== 'failed') continue;
        const error = status.data.errors?.[0];
        const text = [error?.title ?? error?.message, error?.error_data?.details].filter(Boolean).join(' – ');
        updates.push({
          waMessageId: status.data.id,
          status: kind,
          errorCode: error?.code !== undefined ? String(error.code) : null,
          errorText: text ? text.slice(0, 500) : null,
        });
      }
    }
  }
  return updates;
}

/**
 * Which stored statuses each incoming status may replace. Reports can arrive out of order
 * (for example "delivered" before "sent"), so a status never moves backwards.
 */
export const REPLACEABLE: Record<StatusUpdate['status'], MessageStatus[]> = {
  sent: ['queued'],
  delivered: ['queued', 'sent'],
  read: ['queued', 'sent', 'delivered'],
  failed: ['queued', 'sent'],
};

export type ApplyResult = 'updated' | 'ignored' | 'unknown';

/** Applies one status update as a single conditional UPDATE. */
export async function applyStatusUpdate(update: StatusUpdate): Promise<ApplyResult> {
  const failed = update.status === 'failed';
  const result = await prisma.message.updateMany({
    where: { waMessageId: update.waMessageId, status: { in: REPLACEABLE[update.status] } },
    data: {
      status: update.status,
      errorCode: failed ? update.errorCode : null,
      errorText: failed ? (update.errorText ?? 'Delivery failed') : null,
    },
  });
  if (result.count > 0) {
    if (failed) await getMessagingIfConfigured()?.recordLateFailure().catch(() => undefined);
    return 'updated';
  }
  const known = await prisma.message.findUnique({ where: { waMessageId: update.waMessageId }, select: { id: true } });
  return known ? 'ignored' : 'unknown';
}

const RETRY_DELAYS_MS = [1000, 3000, 8000];

/**
 * Applies every status in a webhook payload. A report can reach us a moment before the
 * worker has stored that message's ID; those are retried shortly in the background.
 */
export async function handleWebhookPayload(payload: unknown): Promise<{ updated: number; ignored: number; unknown: number }> {
  const summary = { updated: 0, ignored: 0, unknown: 0 };
  const results = await Promise.all(
    extractStatuses(payload).map(async (update) => ({ update, result: await applyStatusUpdate(update) })),
  );
  for (const { update, result } of results) {
    summary[result]++;
    if (result === 'unknown') retryLater(update, 0);
  }
  return summary;
}

function retryLater(update: StatusUpdate, attempt: number): void {
  const delay = RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return;
  setTimeout(() => {
    applyStatusUpdate(update)
      .then((result) => {
        if (result === 'unknown') retryLater(update, attempt + 1);
      })
      .catch(() => undefined);
  }, delay).unref();
}

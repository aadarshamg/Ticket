import type { PassStatus, Prisma } from '@prisma/client';
import { generateUniqueCodes } from '../lib/codes';
import { table } from '../lib/sql';
import { HttpError } from '../middleware/errors';

export interface PassRef {
  id: string;
  passNo: number;
  status: PassStatus;
}

export interface PassPlan {
  /** Unused passes to delete. */
  remove: string[];
  /** Passes whose number changes so the booking stays numbered 1..n. */
  renumber: { id: string; passNo: number }[];
  /** Pass numbers to create. */
  add: number[];
}

export type PassPlanResult = { ok: true; plan: PassPlan } | { ok: false; reason: string };

/**
 * Works out how to take a booking from its current passes to `newCount` passes.
 * Only unused passes are ever removed (highest numbers first); a used pass is never deleted.
 */
export function planPassCountChange(passes: PassRef[], newCount: number): PassPlanResult {
  const used = passes.filter((pass) => pass.status === 'used').length;
  if (newCount < used) {
    return {
      ok: false,
      reason: `cannot reduce to ${newCount} ${newCount === 1 ? 'pass' : 'passes'}: ${used} already used`,
    };
  }

  const surplus = Math.max(0, passes.length - newCount);
  const remove = passes
    .filter((pass) => pass.status !== 'used')
    .sort((a, b) => b.passNo - a.passNo)
    .slice(0, surplus);
  const removed = new Set(remove.map((pass) => pass.id));

  const kept = passes.filter((pass) => !removed.has(pass.id)).sort((a, b) => a.passNo - b.passNo);
  const renumber = kept
    .map((pass, index) => ({ id: pass.id, passNo: index + 1, from: pass.passNo }))
    .filter((pass) => pass.passNo !== pass.from)
    .map(({ id, passNo }) => ({ id, passNo }));

  const add: number[] = [];
  for (let passNo = kept.length + 1; passNo <= newCount; passNo++) add.push(passNo);

  return { ok: true, plan: { remove: remove.map((pass) => pass.id), renumber, add } };
}

export function isEmptyPlan(plan: PassPlan): boolean {
  return plan.remove.length === 0 && plan.renumber.length === 0 && plan.add.length === 0;
}

export interface PassChanges {
  remove: string[];
  renumber: { id: string; passNo: number }[];
  add: { ticketId: string; passNo: number; status: PassStatus }[];
}

/**
 * Applies pass removals, renumbering and additions for any number of bookings in a handful
 * of statements. Must run inside a transaction: if a pass marked for removal was scanned in
 * the meantime the whole change is rejected.
 */
export async function applyPassChanges(tx: Prisma.TransactionClient, changes: PassChanges): Promise<void> {
  if (changes.remove.length > 0) {
    const deleted = await tx.pass.deleteMany({
      where: { id: { in: changes.remove }, status: { not: 'used' } },
    });
    if (deleted.count !== changes.remove.length) {
      throw new HttpError(409, 'pass_in_use', 'A pass was scanned at the gate while saving. Please try again.');
    }
  }

  if (changes.renumber.length > 0) {
    // (ticketId, passNo) is unique, so move the affected passes out of the way first.
    const json = JSON.stringify(changes.renumber);
    await tx.$executeRaw`
      UPDATE ${table('Pass')} SET "passNo" = -"passNo"
      WHERE "id" IN (SELECT (j->>'id')::uuid FROM jsonb_array_elements(${json}::jsonb) AS j)`;
    await tx.$executeRaw`
      UPDATE ${table('Pass')} AS p SET "passNo" = (j->>'passNo')::int
      FROM jsonb_array_elements(${json}::jsonb) AS j
      WHERE p."id" = (j->>'id')::uuid`;
  }

  if (changes.add.length > 0) {
    const codes = generateUniqueCodes(changes.add.length);
    const data = changes.add.map((pass, index) => ({ ...pass, code: codes[index] as string }));
    for (let i = 0; i < data.length; i += 1000) {
      await tx.pass.createMany({ data: data.slice(i, i + 1000) });
    }
  }
}

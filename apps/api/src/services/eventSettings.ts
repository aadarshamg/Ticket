import type { Event, Gate, Prisma } from '@prisma/client';
import { prisma, TX_OPTIONS } from '../db';
import { audit, type Actor } from '../lib/audit';
import { eventNights, nightLabel } from '../lib/nights';
import { hashPin, verifyHash } from '../lib/passwords';
import { HttpError } from '../middleware/errors';
import type { EventInput, GateInput } from '../schemas/event';
import { invalidateEventCache } from './eventCache';
import { invalidateGateCache } from './gates';

const EVENT_ID = 1;

/** Gate fields that are safe to send to the admin UI. The PIN hash never leaves the API. */
const gateSelect = { id: true, name: true, active: true, createdAt: true, updatedAt: true } as const;

export async function getSettings() {
  const [event, gates] = await Promise.all([
    prisma.event.findUnique({ where: { id: EVENT_ID } }),
    prisma.gate.findMany({ select: gateSelect, orderBy: { name: 'asc' } }),
  ]);
  const nights = event ? eventNights(event).map((date) => ({ date, label: nightLabel(date) })) : [];
  return { event, gates, nights };
}

type EventFields = Omit<EventInput, 'gates'>;

function changedFields(before: Event | null, after: EventFields): string[] {
  if (!before) return Object.keys(after);
  return (Object.keys(after) as (keyof EventFields)[]).filter((key) => {
    const a = before[key];
    const b = after[key];
    return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
  });
}

interface GatePlan {
  toDelete: Gate[];
  toUpdate: { gate: Gate; data: Prisma.GateUpdateInput; pinReset: boolean }[];
  toCreate: { name: string; active: boolean; pinHash: string }[];
}

/**
 * Works out the gate changes and hashes any new PINs. Done before the database
 * transaction opens because bcrypt is slow.
 */
async function planGateChanges(inputs: GateInput[], existing: Gate[]): Promise<GatePlan> {
  const existingById = new Map(existing.map((gate) => [gate.id, gate]));
  const inputById = new Map<string, GateInput>();

  inputs.forEach((input, index) => {
    if (!input.id) return;
    if (!existingById.has(input.id)) {
      throw new HttpError(400, 'validation_error', 'Some fields are invalid', [
        { path: `gates.${index}.id`, message: 'This gate no longer exists. Reload the page.' },
      ]);
    }
    inputById.set(input.id, input);
  });

  // A new PIN must not match the PIN of any gate that is keeping its current one.
  const keepingPin = existing.filter((gate) => {
    const input = inputById.get(gate.id);
    return input !== undefined && !input.pin;
  });
  for (const [index, input] of inputs.entries()) {
    if (!input.pin) continue;
    for (const other of keepingPin) {
      if (await verifyHash(input.pin, other.pinHash)) {
        throw new HttpError(409, 'pin_in_use', 'Each gate needs its own PIN', [
          { path: `gates.${index}.pin`, message: `This PIN is already used by ${other.name}` },
        ]);
      }
    }
  }

  const plan: GatePlan = {
    toDelete: existing.filter((gate) => !inputById.has(gate.id)),
    toUpdate: [],
    toCreate: [],
  };

  for (const input of inputs) {
    const pinHash = input.pin ? await hashPin(input.pin) : undefined;
    const gate = input.id ? existingById.get(input.id) : undefined;
    if (!gate) {
      // The schema guarantees a new gate has a PIN.
      plan.toCreate.push({ name: input.name, active: input.active, pinHash: pinHash as string });
      continue;
    }
    const data: Prisma.GateUpdateInput = {};
    if (input.name !== gate.name) data.name = input.name;
    if (input.active !== gate.active) data.active = input.active;
    if (pinHash) data.pinHash = pinHash;
    if (Object.keys(data).length > 0) {
      plan.toUpdate.push({ gate, data, pinReset: pinHash !== undefined });
    }
  }
  return plan;
}

export async function saveSettings(input: EventInput, actor: Actor) {
  const { gates: gateInputs, ...fields } = input;
  const plan = gateInputs ? await planGateChanges(gateInputs, await prisma.gate.findMany()) : null;

  await prisma.$transaction(async (tx) => {
    const before = await tx.event.findUnique({ where: { id: EVENT_ID } });
    const changed = changedFields(before, fields);
    await tx.event.upsert({
      where: { id: EVENT_ID },
      create: { id: EVENT_ID, ...fields },
      update: fields,
    });
    if (changed.length > 0) {
      await audit(tx, actor, before ? 'event.update' : 'event.create', { type: 'Event', id: String(EVENT_ID) }, { changed });
    }

    if (!plan) return;
    // Deletes first so a freed-up name can be reused in the same save.
    for (const gate of plan.toDelete) {
      await tx.gate.delete({ where: { id: gate.id } });
      await audit(tx, actor, 'gate.delete', { type: 'Gate', id: gate.id }, { name: gate.name });
    }
    for (const { gate, data, pinReset } of plan.toUpdate) {
      const updated = await tx.gate.update({ where: { id: gate.id }, data });
      await audit(tx, actor, 'gate.update', { type: 'Gate', id: gate.id }, {
        name: updated.name,
        active: updated.active,
        pinReset,
      });
    }
    for (const data of plan.toCreate) {
      const created = await tx.gate.create({ data });
      await audit(tx, actor, 'gate.create', { type: 'Gate', id: created.id }, { name: created.name });
    }
  }, TX_OPTIONS);

  // A changed or removed gate must stop working for signed-in volunteers straight away.
  invalidateGateCache();
  invalidateEventCache();
  return getSettings();
}

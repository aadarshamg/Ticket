import type { Gate } from '@prisma/client';
import { prisma } from '../db';
import { verifyHash } from '../lib/passwords';

/** The active gate whose PIN this is, or null. PINs are unique across gates. */
export async function findGateByPin(pin: string): Promise<Gate | null> {
  const gates = await prisma.gate.findMany({ where: { active: true } });
  let match: Gate | null = null;
  // Check every gate even after a match, so the time taken does not hint at which gate matched.
  for (const gate of gates) {
    if (await verifyHash(pin, gate.pinHash)) match ??= gate;
  }
  return match;
}

// Scans check on every request that the volunteer's gate still exists, is active and has
// not had its PIN reset. A short cache keeps that from costing a database query per scan.
const CACHE_MS = 15_000;
let cache: { at: number; gates: Map<string, { active: boolean; version: number }> } | undefined;

export function invalidateGateCache(): void {
  cache = undefined;
}

/** True if a session signed in to `gateId` when the gate's version was `gateVersion` is still valid. */
/** Refreshing at most this often when a session names a gate the cache does not know yet. */
const MISS_REFRESH_MS = 2000;

async function loadGates() {
  const gates = await prisma.gate.findMany({ select: { id: true, active: true, updatedAt: true } });
  cache = {
    at: Date.now(),
    gates: new Map(gates.map((gate) => [gate.id, { active: gate.active, version: gate.updatedAt.getTime() }])),
  };
  return cache;
}

export async function isGateSessionCurrent(gateId: string, gateVersion: number): Promise<boolean> {
  let current = !cache || Date.now() - cache.at > CACHE_MS ? await loadGates() : cache;
  let gate = current.gates.get(gateId);
  // A gate created moments ago (possibly by another API instance) is not in the cache yet.
  if ((!gate || gate.version !== gateVersion) && Date.now() - current.at > MISS_REFRESH_MS) {
    current = await loadGates();
    gate = current.gates.get(gateId);
  }
  return gate !== undefined && gate.active && gate.version === gateVersion;
}

import type { Event } from '@prisma/client';
import { prisma } from '../db';
import { currentNight } from '../lib/nights';

const CACHE_MS = 30_000;
let cached: { event: Event | null; at: number } | null = null;

/**
 * The event settings, re-read at most every 30 seconds. Scans use this to know which night it
 * is without an extra database round trip; saving the settings clears it at once.
 */
export async function getEventCached(): Promise<Event | null> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { event: await prisma.event.findUnique({ where: { id: 1 } }), at: Date.now() };
  }
  return cached.event;
}

export function invalidateEventCache(): void {
  cached = null;
}

/** The night passes are being checked for right now; null when any night is accepted. */
export async function tonight(): Promise<string | null> {
  const event = await getEventCached();
  return event ? currentNight(event) : null;
}

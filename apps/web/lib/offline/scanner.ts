import { api, ApiError } from '@/lib/api';
import { kvGet, kvSet, queueAdd, queueAll, queueRemove, type PendingCheckin } from './idb';

// Offline scanning, on the phone.
//
// While there is a connection the server decides every scan. When there is none, the phone
// checks the scanned code against a list of valid passes it downloaded earlier, remembers
// who it admitted, and uploads those records when the connection returns. The server then
// re-checks each one; anything that should not have been admitted lands in the organiser's
// conflicts report.

interface OfflineList {
  listId: string;
  generatedAt: string;
  count: number;
  /** A short hash of each valid pass's QR text (not the QR text itself). */
  hashes: string[];
  publicKey: JsonWebKey;
  signature: string;
}

export interface ListInfo {
  count: number;
  generatedAt: string;
}

export type LocalVerdict =
  | { kind: 'admitted' }
  | { kind: 'already'; at: string }
  | { kind: 'not_listed' }
  | { kind: 'no_list' };

const LIST_KEY = 'list';
const ADMITTED_KEY = 'admitted';
const SYNC_BATCH = 50;

let validHashes: Set<string> | null = null;
let listInfo: ListInfo | null = null;
/** Passes this phone has admitted since its list was made: hash -> time. Blocks a second entry. */
let admitted = new Map<string, string>();
let pending: PendingCheckin[] = [];
/** True if a check-in could not be written to the phone's storage (it is then held in memory only). */
let storageFailed = false;
let syncing: Promise<SyncResult> | null = null;

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

/** Same hash the server puts in the list: first 12 bytes of SHA-256 of the QR text. */
export async function hashQr(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return base64url(digest.subarray(0, 12));
}

/** Checks the server's signature, so a damaged or tampered list is never used. */
async function verifyList(list: OfflineList): Promise<boolean> {
  try {
    if (!Array.isArray(list.hashes) || list.hashes.length !== list.count) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(list.hashes.join('\n'))));
    const message = encoder.encode(
      `ticketing-offline-list-v1\n${list.listId}\n${list.generatedAt}\n${list.hashes.length}\n${base64url(digest)}`,
    );
    const key = await crypto.subtle.importKey('jwk', list.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromBase64url(list.signature), message);
  } catch {
    return false;
  }
}

function adopt(list: OfflineList): ListInfo {
  validHashes = new Set(list.hashes);
  listInfo = { count: list.count, generatedAt: list.generatedAt };
  return listInfo;
}

const persistAdmitted = () => kvSet(ADMITTED_KEY, [...admitted]).catch(() => undefined);

/** Loads what this phone saved earlier: the list, the admitted passes and unsent check-ins. */
export async function loadSaved(): Promise<void> {
  try {
    pending = await queueAll();
    admitted = new Map((await kvGet<[string, string][]>(ADMITTED_KEY)) ?? []);
    const list = await kvGet<OfflineList>(LIST_KEY);
    if (list && (await verifyList(list))) adopt(list);
  } catch {
    // No usable storage on this phone: online scanning still works.
  }
}

/** Downloads a fresh list. Throws if there is no connection or the list fails its signature check. */
export async function downloadList(): Promise<ListInfo> {
  const list = await api<OfflineList>('/api/scan/offline-list', { timeoutMs: 20_000 });
  if (!(await verifyList(list))) throw new Error('The downloaded list failed its signature check and was not saved.');
  await kvSet(LIST_KEY, list).catch(() => undefined);
  const info = adopt(list);
  if (pending.length === 0) {
    // Everything this phone admitted has reached the server, so the new list already leaves it out.
    admitted = new Map();
    void persistAdmitted();
  }
  return info;
}

/** Call after the server admits a pass online, so this phone will not admit it again if it then goes offline. */
export async function noteAdmitted(qr: string): Promise<void> {
  admitted.set(await hashQr(qr), new Date().toISOString());
  void persistAdmitted();
}

/**
 * Checks a scanned code against the saved list. If it is valid, the admission is stored on
 * the phone BEFORE this resolves, so a green screen always has a record behind it.
 */
export async function checkLocally(qr: string, clientRef: string): Promise<LocalVerdict> {
  if (!validHashes) return { kind: 'no_list' };
  const hash = await hashQr(qr);
  const earlier = admitted.get(hash);
  if (earlier) return { kind: 'already', at: earlier };
  if (!validHashes.has(hash)) return { kind: 'not_listed' };

  const item: PendingCheckin = { clientRef, qr, scannedAt: new Date().toISOString() };
  pending.push(item);
  admitted.set(hash, item.scannedAt);
  try {
    await queueAdd(item);
  } catch {
    storageFailed = true; // kept in memory; the page must stay open until it syncs
  }
  void persistAdmitted();
  return { kind: 'admitted' };
}

/** Removes a stored check-in the server turned out to have recorded itself (its late answer arrived). */
export async function dropPending(clientRef: string): Promise<void> {
  pending = pending.filter((item) => item.clientRef !== clientRef);
  await queueRemove([clientRef]).catch(() => undefined);
}

export interface SyncResult {
  uploaded: number;
  /** Uploaded admissions the server could not accept as valid (reported to the organiser). */
  conflicts: number;
  /** The gate session ended; the volunteer must enter the PIN again before the rest can upload. */
  sessionEnded: boolean;
}

/** Uploads stored check-ins. Safe to call often; only one upload runs at a time. */
export function syncPending(): Promise<SyncResult> {
  syncing ??= (async () => {
    const result: SyncResult = { uploaded: 0, conflicts: 0, sessionEnded: false };
    try {
      while (pending.length > 0) {
        const batch = pending.slice(0, SYNC_BATCH);
        const response = await api<{ results: { clientRef: string; result: string }[] }>('/api/scan/sync', {
          method: 'POST',
          body: { checkins: batch },
          timeoutMs: 30_000,
        });
        const done = new Set(response.results.map((entry) => entry.clientRef));
        pending = pending.filter((item) => !done.has(item.clientRef));
        await queueRemove([...done]).catch(() => undefined);
        result.uploaded += done.size;
        result.conflicts += response.results.filter((entry) => entry.result !== 'ok').length;
        if (done.size === 0) break; // nothing accepted: do not spin
      }
      if (pending.length === 0) storageFailed = false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) result.sessionEnded = true;
      // Otherwise still offline (or the server is busy): keep the records and try again later.
    }
    return result;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export function offlineStatus() {
  return { list: listInfo, pending: pending.length, storageFailed };
}

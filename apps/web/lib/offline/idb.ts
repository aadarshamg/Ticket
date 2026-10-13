// A very small IndexedDB wrapper for the scanner: one key-value store and one queue of
// check-ins waiting to be uploaded. IndexedDB survives the page being closed or the phone
// restarting, which is the point: an admission made offline must not be lost.

const DB_NAME = 'tk-scanner';
const KV = 'kv';
const QUEUE = 'checkins';

export interface PendingCheckin {
  /** Unique per scan; lets the server ignore a record it has already been sent. */
  clientRef: string;
  /** The QR text exactly as scanned; the server re-verifies it. */
  qr: string;
  /** When this phone admitted the person (ISO time). */
  scannedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KV);
      request.result.createObjectStore(QUEUE, { keyPath: 'clientRef' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null; // let the next call try again
    throw error;
  });
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve((request ? request.result : undefined) as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kvGet = <T>(key: string) => run<T | undefined>(KV, 'readonly', (store) => store.get(key));
export const kvSet = (key: string, value: unknown) => run<IDBValidKey>(KV, 'readwrite', (store) => store.put(value, key));

export const queueAdd = (item: PendingCheckin) => run<IDBValidKey>(QUEUE, 'readwrite', (store) => store.put(item));
export const queueAll = () => run<PendingCheckin[]>(QUEUE, 'readonly', (store) => store.getAll());
export const queueRemove = (clientRefs: string[]) =>
  run<void>(QUEUE, 'readwrite', (store) => {
    for (const ref of clientRefs) store.delete(ref);
  });

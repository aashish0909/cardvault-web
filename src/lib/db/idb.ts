// IndexedDB connection, transactions, and the kv store used by lib/vault.ts.

export const DB_NAME = 'cardvault-web';
const DB_VERSION = 1;
const STORES = ['kv', 'cards', 'peers', 'shares', 'shared_cards', 'requests'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Close the cached connection (required before deleteDatabase can complete). */
export function closeDb(): void {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {});
    dbPromise = null;
  }
}

/** Drop every row in every store. */
export async function clearAllStores(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([...STORES], 'readwrite');
    for (const name of STORES) {
      t.objectStore(name).clear();
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export { openDb };

interface KvRow {
  id: string;
  value: string;
}

export function kvGet(key: string): Promise<string | null> {
  return tx<KvRow | undefined>('kv', 'readonly', (s) => s.get(key)).then((r) => r?.value ?? null);
}

export function kvSet(key: string, value: string): Promise<void> {
  return tx('kv', 'readwrite', (s) => s.put({ id: key, value })).then(() => undefined);
}

export function kvDelete(key: string): Promise<void> {
  return tx('kv', 'readwrite', (s) => s.delete(key)).then(() => undefined);
}

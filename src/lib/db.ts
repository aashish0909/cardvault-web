// Local vault storage (IndexedDB). Ported from the native app's lib/db.ts
// (expo-sqlite) with the same table shapes and function names so the relay /
// pairing layers port 1:1.
//
// Cards: `payload` is the AES-GCM encrypted JSON of CardSecrets (see
// lib/crypto.ts). Only non-sensitive metadata (nickname, network, last4) is
// stored in the clear so lists render without touching the encryption key.
//
// Secrets (wrapped master key, passkey binding, identity) live in the `kv`
// store and are written only by lib/vault.ts.

export interface CardSecrets {
  holderName: string;
  pan: string;
  expiry: string; // "MM/YY"
  cvv: string;
}

export interface CardRow {
  id: string;
  nickname: string;
  network: string;
  last4: string;
  color: string;
  payload: string; // encrypted CardSecrets
  createdAt: number;
}

export type PeerDirection = 'in' | 'out';
export type PeerStatus = 'pending' | 'paired';

export interface PeerRow {
  id: string; // device id
  name: string;
  publicKey: string; // hex X25519 public key
  direction: PeerDirection;
  status: PeerStatus;
  createdAt: number;
}

export interface ShareRow {
  id: string;
  cardId: string;
  peerId: string;
  /**
   * Recipient display name. Set for nearby (offline) shares where no peer
   * record exists; relay shares resolve the name from the peer record.
   */
  name: string | null;
  /**
   * Recipient X25519 public key. Set for nearby shares so a best-effort
   * revoke can still be sealed to the recipient even though they are not a
   * paired peer. Null for relay shares (looked up from the peer record).
   */
  publicKey: string | null;
  createdAt: number;
}

export type SharedCardStatus = 'new' | 'accepted' | 'removed';

export interface SharedCardRow {
  id: string;
  peerId: string;
  ownerCardId: string;
  nickname: string;
  network: string;
  last4: string;
  color: string;
  /** Local-only display label chosen by the recipient; falls back to nickname when null. */
  label: string | null;
  status: SharedCardStatus;
  /**
   * Full details for a nearby (offline) share, sealed to this device with
   * crypto_box and stored encrypted at rest. Present only for offline
   * shares and only opened once the owner approves a face-to-face request.
   * Null for relay shares (details arrive per approved window instead).
   */
  sealed: string | null;
  /** Owner X25519 public key captured at the offline share, so this device
   *  can seal a details request back to the owner without a peer record. */
  ownerPub: string | null;
  createdAt: number;
}

export type RequestDirection = 'in' | 'out';
export type RequestKind = 'details' | 'otp';
export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'expired'
  | 'revoked';

export interface RequestRow {
  id: string;
  direction: RequestDirection;
  peerId: string;
  cardId: string;
  kind: RequestKind;
  amount: string | null;
  merchant: string | null;
  status: RequestStatus;
  windowExpiresAt: number | null;
  createdAt: number;
  resolvedAt: number | null;
}

export const DB_NAME = 'cardvault-web';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['kv', 'cards', 'peers', 'shares', 'shared_cards', 'requests']) {
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
    const t = db.transaction(['kv', 'cards', 'peers', 'shares', 'shared_cards', 'requests'], 'readwrite');
    for (const name of ['kv', 'cards', 'peers', 'shares', 'shared_cards', 'requests']) {
      t.objectStore(name).clear();
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function tx<T>(
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

// --- kv ----------------------------------------------------------------

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

// --- cards ----------------------------------------------------------------

export async function listCards(): Promise<CardRow[]> {
  const rows = await tx<CardRow[]>('cards', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCard(id: string): Promise<CardRow | null> {
  return (await tx<CardRow | undefined>('cards', 'readonly', (s) => s.get(id))) ?? null;
}

export interface NewCard {
  nickname: string;
  network: string;
  last4: string;
  color: string;
  payload: string;
}

export async function insertCard(card: NewCard): Promise<CardRow> {
  const row: CardRow = { id: crypto.randomUUID(), createdAt: Date.now(), ...card };
  await tx('cards', 'readwrite', (s) => s.put(row));
  return row;
}

export async function deleteCard(id: string): Promise<void> {
  await tx('cards', 'readwrite', (s) => s.delete(id));
}

// --- peers ----------------------------------------------------------------

export async function listPeers(): Promise<PeerRow[]> {
  const rows = await tx<PeerRow[]>('peers', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPeer(deviceId: string): Promise<PeerRow | null> {
  return (await tx<PeerRow | undefined>('peers', 'readonly', (s) => s.get(deviceId))) ?? null;
}

export async function upsertPeer(peer: Omit<PeerRow, 'createdAt'>): Promise<void> {
  const existing = await getPeer(peer.id);
  const row: PeerRow = {
    ...peer,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await tx('peers', 'readwrite', (s) => s.put(row));
}

export async function setPeerStatus(deviceId: string, status: PeerStatus): Promise<void> {
  const row = await getPeer(deviceId);
  if (row) await tx('peers', 'readwrite', (s) => s.put({ ...row, status }));
}

export async function setPeerName(deviceId: string, name: string): Promise<void> {
  const row = await getPeer(deviceId);
  if (row) await tx('peers', 'readwrite', (s) => s.put({ ...row, name }));
}

export async function deletePeer(deviceId: string): Promise<void> {
  await tx('peers', 'readwrite', (s) => s.delete(deviceId));
}

// --- shares (owner side) --------------------------------------------------

export async function listShares(cardId?: string): Promise<ShareRow[]> {
  const rows = await tx<ShareRow[]>('shares', 'readonly', (s) => s.getAll());
  const filtered = cardId ? rows.filter((r) => r.cardId === cardId) : rows;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addShare(
  cardId: string,
  peerId: string,
  meta: { name?: string | null; publicKey?: string | null } = {}
): Promise<void> {
  await tx('shares', 'readwrite', (s) =>
    s.put({
      id: crypto.randomUUID(),
      cardId,
      peerId,
      name: meta.name ?? null,
      publicKey: meta.publicKey ?? null,
      createdAt: Date.now(),
    })
  );
}

export async function removeShare(cardId: string, peerId: string): Promise<void> {
  const rows = await tx<ShareRow[]>('shares', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.cardId === cardId && r.peerId === peerId)
      .map((r) => tx('shares', 'readwrite', (s) => s.delete(r.id)))
  );
}

// --- shared cards (recipient side) ----------------------------------------

function normalizeSharedCard(r: SharedCardRow): SharedCardRow {
  return { ...r, sealed: r.sealed ?? null, ownerPub: r.ownerPub ?? null };
}

export async function listSharedCards(): Promise<SharedCardRow[]> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  return rows
    .filter((r) => r.status !== 'removed')
    .map(normalizeSharedCard)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSharedCard(id: string): Promise<SharedCardRow | null> {
  const row = await tx<SharedCardRow | undefined>('shared_cards', 'readonly', (s) => s.get(id));
  return row ? normalizeSharedCard(row) : null;
}

/** Find the currently-shared card from a specific owner, by the owner's card
 *  id. Used by the relay to locate sealed offline details on approval. */
export async function findSharedCard(
  peerId: string,
  ownerCardId: string
): Promise<SharedCardRow | null> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  const row = rows
    .filter(
      (r) => r.peerId === peerId && r.ownerCardId === ownerCardId && r.status !== 'removed'
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return row ? normalizeSharedCard(row) : null;
}

export async function insertSharedCard(
  shared: Omit<SharedCardRow, 'id' | 'createdAt' | 'label' | 'sealed' | 'ownerPub'> & {
    label?: string | null;
    sealed?: string | null;
    ownerPub?: string | null;
  }
): Promise<void> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  const existing = rows
    .filter((r) => r.peerId === shared.peerId && r.ownerCardId === shared.ownerCardId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const label = shared.label !== undefined ? shared.label : (existing?.label ?? null);
  const row: SharedCardRow = {
    ...shared,
    id: crypto.randomUUID(),
    label,
    sealed: shared.sealed ?? null,
    ownerPub: shared.ownerPub ?? null,
    createdAt: Date.now(),
  };
  await tx('shared_cards', 'readwrite', (s) => s.put(normalizeSharedCard(row)));
}

export async function setSharedCardLabel(id: string, label: string | null): Promise<void> {
  const row = await getSharedCard(id);
  if (row) {
    const value = label == null ? null : label.trim().slice(0, 40) || null;
    await tx('shared_cards', 'readwrite', (s) => s.put({ ...row, label: value }));
  }
}

export async function setSharedCardStatus(id: string, status: SharedCardStatus): Promise<void> {
  const row = await getSharedCard(id);
  if (row) await tx('shared_cards', 'readwrite', (s) => s.put({ ...row, status }));
}

export async function removeSharedByOwner(peerId: string, ownerCardId: string): Promise<void> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId && r.ownerCardId === ownerCardId && r.status !== 'removed')
      .map((r) => tx('shared_cards', 'readwrite', (s) => s.put({ ...r, status: 'removed' as const })))
  );
}

export async function cancelRequestsForCard(peerId: string, ownerCardId: string): Promise<void> {
  const rows = await tx<RequestRow[]>('requests', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId && r.cardId === ownerCardId && r.status === 'pending')
      .map((r) => tx('requests', 'readwrite', (s) => s.put({ ...r, status: 'cancelled' as const, resolvedAt: Date.now() })))
  );
}

export async function removeSharedCardsByPeer(peerId: string): Promise<void> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId && r.status !== 'removed')
      .map((r) => tx('shared_cards', 'readwrite', (s) => s.put({ ...r, status: 'removed' as const })))
  );
}

export async function removeSharesByPeer(peerId: string): Promise<void> {
  const rows = await tx<ShareRow[]>('shares', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId)
      .map((r) => tx('shares', 'readwrite', (s) => s.delete(r.id)))
  );
}

// --- requests --------------------------------------------------------------

export async function insertRequest(
  request: Omit<RequestRow, 'createdAt' | 'resolvedAt' | 'windowExpiresAt' | 'amount' | 'merchant'> & {
    amount?: string | null;
    merchant?: string | null;
    createdAt?: number;
  }
): Promise<RequestRow> {
  const row: RequestRow = {
    ...request,
    amount: request.amount ?? null,
    merchant: request.merchant ?? null,
    createdAt: request.createdAt ?? Date.now(),
    windowExpiresAt: null,
    resolvedAt: null,
  };
  await tx('requests', 'readwrite', (s) => s.put(row));
  return row;
}

export async function listRequests(): Promise<RequestRow[]> {
  const rows = await tx<RequestRow[]>('requests', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRequest(id: string): Promise<RequestRow | null> {
  return (await tx<RequestRow | undefined>('requests', 'readonly', (s) => s.get(id))) ?? null;
}

export async function setRequestStatus(
  id: string,
  status: RequestStatus,
  windowExpiresAt: number | null = null
): Promise<void> {
  const row = await getRequest(id);
  if (row) {
    await tx('requests', 'readwrite', (s) =>
      s.put({
        ...row,
        status,
        windowExpiresAt,
        resolvedAt: status === 'pending' ? null : Date.now(),
      })
    );
  }
}

export async function clearRequestHistory(): Promise<void> {
  const rows = await tx<RequestRow[]>('requests', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.status !== 'pending')
      .map((r) => tx('requests', 'readwrite', (s) => s.delete(r.id)))
  );
}

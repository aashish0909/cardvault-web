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

export * from './types';
export { DB_NAME, closeDb, clearAllStores, kvGet, kvSet, kvDelete } from './idb';
export { listCards, getCard, insertCard, deleteCard, type NewCard } from './cards';
export { listPeers, getPeer, upsertPeer, setPeerStatus, setPeerName, deletePeer } from './peers';
export {
  listShares,
  addShare,
  removeShare,
  listSharedCards,
  getSharedCard,
  findSharedCard,
  insertSharedCard,
  setSharedCardLabel,
  setSharedCardStatus,
  removeSharedByOwner,
  cancelRequestsForCard,
  removeSharedCardsByPeer,
  removeSharesByPeer,
} from './shares';
export {
  insertRequest,
  listRequests,
  getRequest,
  setRequestStatus,
  clearRequestHistory,
} from './requests';

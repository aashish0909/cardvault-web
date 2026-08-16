import * as db from '../db';

export interface IncomingCtx {
  getPeer: (deviceId: string) => Promise<db.PeerRow | null>;
  upsertPeer: (p: Omit<db.PeerRow, 'createdAt'>) => Promise<void>;
  setPeerStatus: (deviceId: string, status: db.PeerStatus) => Promise<void>;
  setPeerName: (deviceId: string, name: string) => Promise<void>;
  deletePeer: (deviceId: string) => Promise<void>;
  insertSharedCard: (
    s: Omit<
      db.SharedCardRow,
      'id' | 'createdAt' | 'label' | 'sealed' | 'ownerPub'
    > & {
      label?: string | null;
      sealed?: string | null;
      ownerPub?: string | null;
    }
  ) => Promise<void>;
  removeSharedByOwner: (peerId: string, ownerCardId: string) => Promise<void>;
  cancelRequestsForCard: (peerId: string, ownerCardId: string) => Promise<void>;
  removeSharedCardsByPeer: (peerId: string) => Promise<void>;
  insertRequest: (
    r: Omit<
      db.RequestRow,
      'createdAt' | 'resolvedAt' | 'windowExpiresAt' | 'amount' | 'merchant'
    > & { amount?: string | null; merchant?: string | null }
  ) => Promise<db.RequestRow>;
  getRequest: (id: string) => Promise<db.RequestRow | null>;
  listRequests: () => Promise<db.RequestRow[]>;
  setRequestStatus: (id: string, status: db.RequestStatus, windowExpiresAt?: number | null) => Promise<void>;
  findSharedCard: (peerId: string, ownerCardId: string) => Promise<db.SharedCardRow | null>;
  /** True when `peerId` holds a nearby (offline) share of `cardId` - i.e. the
   *  full details already sit sealed on the recipient and approvals must not
   *  carry them over the relay. */
  hasNearbyShare: (cardId: string, peerId: string) => Promise<boolean>;
}

export const defaultCtx: IncomingCtx = {
  getPeer: db.getPeer,
  upsertPeer: db.upsertPeer,
  setPeerStatus: db.setPeerStatus,
  setPeerName: db.setPeerName,
  deletePeer: db.deletePeer,
  insertSharedCard: db.insertSharedCard,
  removeSharedByOwner: db.removeSharedByOwner,
  cancelRequestsForCard: db.cancelRequestsForCard,
  removeSharedCardsByPeer: db.removeSharedCardsByPeer,
  insertRequest: db.insertRequest,
  getRequest: db.getRequest,
  listRequests: db.listRequests,
  setRequestStatus: db.setRequestStatus,
  findSharedCard: db.findSharedCard,
  hasNearbyShare: async (cardId, peerId) => {
    const shares = await db.listShares(cardId);
    return shares.some((s) => s.peerId === peerId && s.nearby === true);
  },
};

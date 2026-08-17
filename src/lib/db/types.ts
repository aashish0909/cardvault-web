// IndexedDB row shapes. Cards store encrypted secrets in `payload`; only
// nickname / network / last4 stay in the clear for list rendering.

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
  /**
   * True only for nearby (offline) shares. Must stay false for relay shares
   * so details-approve still carries secrets over the relay. Older rows
   * without this field are treated as relay shares.
   */
  nearby: boolean;
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

// Nearby (offline) sharing: send a card to someone standing next to you.
//
// Two-step QR handshake that needs no relay or internet:
//   1. The receiver shows their identity QR - a public key, safe to share.
//   2. The sender scans it and shows a QR whose payload carries the card
//      details sealed to that key (lib/e2e.ts crypto_box). Only the
//      receiver's secret key can open it, so the QR is useless to anyone
//      else and may be photographed freely.
//   3. The receiver scans the payload QR, sees a masked preview, and accepts.
//      The sealed details are stored encrypted on the receiver's device but
//      are NOT revealed yet.
//
// The delivery of the card details is the only offline part - it never goes
// over the internet. The consent part (request details -> owner approves with
// a reveal window) is the normal relay flow, exactly like paired friends; the
// approval just carries no secrets because the full details already sit
// sealed on the receiver's device and are decrypted locally when approved.
//
// The QR itself carries only masked metadata (nickname, network, last4) in
// the clear - the same non-sensitive data the relay already sees in a
// regular 'card-share' blob.

import type { CardSecrets } from './db';
import * as db from './db';
import { sealTo } from './e2e';

/** How long a shown nearby-share QR stays valid. */
export const NEARBY_QR_TTL_MS = 5 * 60 * 1000;

export interface NearbySharePayload {
  v: 1;
  kind: 'nearby-share';
  from: string; // sender (owner) deviceId
  fromName: string; // sender display name
  fromPub: string; // sender X25519 public key, so the receiver is established
  // as a relay peer for the consent flow without a fresh pairing
  cardId: string; // sender's card id
  nickname: string;
  network: string;
  last4: string;
  color: string;
  expiresAt: number;
  sealed: string; // sealTo(JSON.stringify({ cardId, secrets }))
}

export async function buildNearbyShare(input: {
  from: string;
  fromName: string;
  fromPub: string;
  cardId: string;
  nickname: string;
  network: string;
  last4: string;
  color: string;
  recipientPubHex: string;
  secrets: CardSecrets;
}): Promise<string> {
  const sealed = await sealTo(
    JSON.stringify({ cardId: input.cardId, secrets: input.secrets }),
    input.recipientPubHex
  );
  const payload: NearbySharePayload = {
    v: 1,
    kind: 'nearby-share',
    from: input.from,
    fromName: input.fromName,
    fromPub: input.fromPub,
    cardId: input.cardId,
    nickname: input.nickname,
    network: input.network,
    last4: input.last4,
    color: input.color,
    expiresAt: Date.now() + NEARBY_QR_TTL_MS,
    sealed,
  };
  return JSON.stringify(payload);
}

export function parseNearbyShare(raw: unknown): NearbySharePayload {
  let p = raw as Partial<NearbySharePayload> | null;
  if (typeof raw === 'string') {
    try {
      p = JSON.parse(raw) as Partial<NearbySharePayload> | null;
    } catch {
      throw new Error('That is not a valid nearby share QR.');
    }
  }
  if (
    !p ||
    p.v !== 1 ||
    p.kind !== 'nearby-share' ||
    typeof p.from !== 'string' ||
    typeof p.fromName !== 'string' ||
    typeof p.fromPub !== 'string' ||
    typeof p.cardId !== 'string' ||
    typeof p.nickname !== 'string' ||
    typeof p.network !== 'string' ||
    typeof p.last4 !== 'string' ||
    typeof p.color !== 'string' ||
    typeof p.expiresAt !== 'number' ||
    typeof p.sealed !== 'string'
  ) {
    throw new Error('That is not a valid nearby share QR.');
  }
  return p as NearbySharePayload;
}

/**
 * Accept a scanned nearby share: stores the masked card with the sealed
 * details (never revealed yet) and establishes a paired peer for the sender
 * so the consent flow (details/OTP requests) can ride the relay later. The
 * card details themselves stay offline, sealed on this device.
 */
export async function acceptNearbyShare(share: NearbySharePayload): Promise<void> {
  await db.insertSharedCard({
    peerId: share.from,
    ownerCardId: share.cardId,
    nickname: share.nickname,
    network: share.network,
    last4: share.last4,
    color: share.color,
    status: 'accepted',
    sealed: share.sealed,
    ownerPub: share.fromPub,
  });
  await db.upsertPeer({
    id: share.from,
    name: share.fromName,
    publicKey: share.fromPub,
    direction: 'in',
    status: 'paired',
  });
}
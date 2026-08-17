import { useRevealStore, DETAILS_WINDOW_MS, OTP_WINDOW_MS } from '../reveal';
import * as db from '../db';
import { deleteRelayBlob, sendBlob, sendBlobToPub } from './client';
import { defaultCtx, type IncomingCtx } from './types';

const outboundBlobs = new Map<string, string>();
const pendingCancels = new Map<
  string,
  { peerId: string; cardId: string; kind: db.RequestKind }
>();

function rememberOutboundBlob(requestId: string, blobId: string): void {
  if (blobId) outboundBlobs.set(requestId, blobId);
}

async function withdrawOutboundBlob(requestId: string): Promise<void> {
  const blobId = outboundBlobs.get(requestId);
  outboundBlobs.delete(requestId);
  if (blobId) await deleteRelayBlob(blobId).catch(() => {});
}

async function deliverCancel(
  peerId: string,
  request: { id: string; cardId: string; kind: db.RequestKind },
  ctx: Pick<IncomingCtx, 'getPeer'>
): Promise<void> {
  await sendBlob(
    peerId,
    'request-cancel',
    { requestId: request.id, cardId: request.cardId, kind: request.kind },
    ctx
  );
}

export async function flushPendingCancels(
  ctx: Pick<IncomingCtx, 'getPeer'> = { getPeer: db.getPeer }
): Promise<void> {
  if (pendingCancels.size === 0) return;
  const queued = [...pendingCancels.entries()];
  for (const [requestId, item] of queued) {
    try {
      await deliverCancel(
        item.peerId,
        { id: requestId, cardId: item.cardId, kind: item.kind },
        ctx
      );
      pendingCancels.delete(requestId);
    } catch {
      // Stay queued; next poll retries.
    }
  }
}

/** Best-effort revoke of a share (relay or nearby): tells the recipient to
 *  drop the card + clear any revealed details, then removes the local share.
 *  Prefers the recipient's public key captured at share time so a revoke
 *  still works after the friendship is severed (peer record deleted). */
export async function unshareCard(cardId: string, share: db.ShareRow): Promise<void> {
  const notice = { cardId };
  if (share.publicKey) {
    await sendBlobToPub(share.peerId, share.publicKey, 'card-unshare', notice).catch(() => {});
  } else {
    await sendBlob(share.peerId, 'card-unshare', notice).catch(() => {});
  }
  await db.removeShare(cardId, share.peerId);
}

/** Tell every known peer this device's new display name (best effort). */
export async function sendNameUpdate(
  name: string,
  ctx: Pick<IncomingCtx, 'getPeer'> & { listPeers?: () => Promise<db.PeerRow[]> } = {
    getPeer: db.getPeer,
    listPeers: db.listPeers,
  }
): Promise<void> {
  const peers = await (ctx.listPeers ?? db.listPeers)();
  await Promise.all(
    peers.map((peer) =>
      sendBlob(peer.id, 'name-update', { name }, ctx).catch(() => {})
    )
  );
}

/** Request full card details from a paired friend (borrower side). */
export async function requestDetails(
  peerId: string,
  cardId: string,
  ctx: Pick<IncomingCtx, 'insertRequest' | 'getPeer'> = defaultCtx
): Promise<db.RequestRow> {
  const requestId = crypto.randomUUID();
  const blobId = await sendBlob(peerId, 'details-request', { requestId, cardId }, ctx);
  rememberOutboundBlob(requestId, blobId);
  return ctx.insertRequest({
    id: requestId,
    direction: 'out',
    peerId,
    cardId,
    kind: 'details',
    status: 'pending',
  });
}

/** Request an OTP from a paired friend (borrower side). Independent of details. */
export async function requestOtp(
  peerId: string,
  cardId: string,
  amount: string,
  merchant: string,
  ctx: Pick<IncomingCtx, 'insertRequest' | 'listRequests' | 'setRequestStatus' | 'getPeer'> = defaultCtx
): Promise<db.RequestRow> {
  const requestId = crypto.randomUUID();
  const blobId = await sendBlob(
    peerId,
    'otp-request',
    { requestId, cardId, amount, merchant },
    ctx
  );
  rememberOutboundBlob(requestId, blobId);

  // Requesting a new OTP automatically revokes any still-open OTP window for
  // the same card - the old OTP is no longer valid once a fresh one is asked
  // for. Tell the owner so their screen flips to Revoked too, but don't fail
  // the request if that notification can't get out.
  for (const old of await ctx.listRequests()) {
    if (
      old.kind === 'otp' &&
      old.cardId === cardId &&
      old.direction === 'out' &&
      old.status === 'approved'
    ) {
      await sendBlob(peerId, 'request-revoke', { requestId: old.id }).catch(() => {});
      await ctx.setRequestStatus(old.id, 'revoked');
      useRevealStore.get().clearOtp(old.id);
    }
  }

  return ctx.insertRequest({
    id: requestId,
    direction: 'out',
    peerId,
    cardId,
    kind: 'otp',
    amount,
    merchant,
    status: 'pending',
  });
}

/** Owner approves a details request: sends the unlock package + opens the window. */
export async function approveDetails(
  request: db.RequestRow,
  secrets: db.CardSecrets,
  windowMs = DETAILS_WINDOW_MS,
  ctx: Pick<IncomingCtx, 'setRequestStatus' | 'hasNearbyShare'> = defaultCtx
): Promise<void> {
  const expiresAt = Date.now() + windowMs;
  await sendBlob(request.peerId, 'details-approve', {
    requestId: request.id,
    cardId: request.cardId,
    details: secrets,
    expiresAt,
  });
  await ctx.setRequestStatus(request.id, 'approved', expiresAt);
}

/** Owner approves an OTP request: relays the OTP with a short window. */
export async function approveOtp(
  request: db.RequestRow,
  otp: string,
  windowMs = OTP_WINDOW_MS,
  ctx: Pick<IncomingCtx, 'setRequestStatus'> = defaultCtx
): Promise<void> {
  const expiresAt = Date.now() + windowMs;
  await sendBlob(request.peerId, 'otp-approve', {
    requestId: request.id,
    otp,
    expiresAt,
  });
  await ctx.setRequestStatus(request.id, 'approved', expiresAt);
}

/** Owner denies a request. */
export async function denyRequest(
  request: db.RequestRow,
  ctx: Pick<IncomingCtx, 'setRequestStatus'> = defaultCtx
): Promise<void> {
  const kind = request.kind === 'details' ? 'details-deny' : 'otp-deny';
  await sendBlob(request.peerId, kind, { requestId: request.id });
  await ctx.setRequestStatus(request.id, 'denied');
}

/** Borrower withdraws a pending request. */
export async function cancelRequest(
  request: db.RequestRow,
  ctx: Pick<IncomingCtx, 'setRequestStatus' | 'getPeer'> = defaultCtx
): Promise<void> {
  await withdrawOutboundBlob(request.id);
  try {
    await deliverCancel(request.peerId, request, ctx);
    pendingCancels.delete(request.id);
  } catch {
    pendingCancels.set(request.id, {
      peerId: request.peerId,
      cardId: request.cardId,
      kind: request.kind,
    });
  }
  await ctx.setRequestStatus(request.id, 'cancelled');
}

/** Owner revokes an approved window: details/OTP vanish on the borrower's device. */
export async function revokeRequest(
  request: db.RequestRow,
  ctx: Pick<IncomingCtx, 'setRequestStatus'> = defaultCtx
): Promise<void> {
  await sendBlob(request.peerId, 'request-revoke', { requestId: request.id });
  await ctx.setRequestStatus(request.id, 'revoked');
}

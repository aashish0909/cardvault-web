import { openEnvelope } from '../e2e';
import { notify } from '../notify';
import { useRevealStore, DETAILS_WINDOW_MS, OTP_WINDOW_MS } from '../reveal';
import * as db from '../db';
import { defaultCtx, type IncomingCtx } from './types';

function samePub(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Decrypt a blob and, when we already know this sender, require the envelope
 * key to match the stored peer key. A mismatch means a device id is being
 * impersonated with a different identity key.
 */
async function openPeerBlob(
  blob: { from: string; payload: string },
  ctx: IncomingCtx
): Promise<{ data: Record<string, unknown>; senderPub: string; peer: db.PeerRow | null }> {
  const { plaintext, senderPub } = await openEnvelope(blob.payload);
  const peer = await ctx.getPeer(blob.from);
  if (peer && !samePub(peer.publicKey, senderPub)) {
    throw new Error('sender key does not match peer record');
  }
  const data = asRecord(JSON.parse(plaintext));
  if (!data) throw new Error('malformed blob payload');
  return { data, senderPub, peer };
}

/**
 * Decrypt and apply one incoming blob. Returns a short human-readable note
 * (or null if it was unhandled / failed authentication - those are dropped).
 */
export async function handleIncomingBlob(
  blob: { id: string; from: string; kind: string; payload: string },
  ctx: IncomingCtx = defaultCtx
): Promise<string | null> {
  try {
    switch (blob.kind) {
      case 'pair-request': {
        const { data, senderPub } = await openPeerBlob(blob, ctx);
        if (
          typeof data.deviceId !== 'string' ||
          typeof data.name !== 'string' ||
          typeof data.pub !== 'string'
        ) {
          return null;
        }
        if (data.deviceId !== blob.from || !samePub(data.pub, senderPub)) return null;
        const existing = await ctx.getPeer(data.deviceId);
        if (existing && existing.status === 'paired') return null;
        if (existing && !samePub(existing.publicKey, data.pub)) return null;
        await ctx.upsertPeer({
          id: data.deviceId,
          name: data.name,
          publicKey: data.pub,
          direction: 'in',
          status: 'pending',
        });
        return `pair request from ${data.name}`;
      }
      case 'pair-accept': {
        const { peer } = await openPeerBlob(blob, ctx);
        // Pair regardless of direction: the accept is authoritative and must
        // reflect on the requester even when requests crossed (both peers sent
        // each other a request, so each peer row ends up direction 'in').
        if (!peer || peer.status === 'paired') return null;
        await ctx.setPeerStatus(blob.from, 'paired');
        return `paired with ${peer.name}`;
      }
      case 'pair-decline': {
        const { peer } = await openPeerBlob(blob, ctx);
        if (!peer) return null;
        await ctx.deletePeer(blob.from);
        await ctx.removeSharedCardsByPeer(blob.from);
        return 'peer removed';
      }
      case 'name-update': {
        const { data, peer } = await openPeerBlob(blob, ctx);
        if (!peer || typeof data.name !== 'string') return null;
        const name = data.name.trim().slice(0, 40) || 'Friend';
        if (name === peer.name) return null;
        await ctx.setPeerName(blob.from, name);
        return `name updated: ${name}`;
      }
      case 'card-share': {
        const { data } = await openPeerBlob(blob, ctx);
        if (
          typeof data.cardId !== 'string' ||
          typeof data.nickname !== 'string' ||
          typeof data.network !== 'string' ||
          typeof data.last4 !== 'string' ||
          typeof data.color !== 'string'
        ) {
          return null;
        }
        await ctx.insertSharedCard({
          peerId: blob.from,
          ownerCardId: data.cardId,
          nickname: data.nickname,
          network: data.network,
          last4: data.last4,
          color: data.color,
          status: 'new',
        });
        return `card share: ${data.nickname}`;
      }
      case 'card-unshare': {
        const { data } = await openPeerBlob(blob, ctx);
        if (typeof data.cardId !== 'string') return null;
        await ctx.removeSharedByOwner(blob.from, data.cardId);
        await ctx.cancelRequestsForCard(blob.from, data.cardId);
        useRevealStore.get().clearDetails(data.cardId);
        const otpState = useRevealStore.get().otp;
        for (const requestId of Object.keys(otpState)) {
          const r = await ctx.getRequest(requestId);
          if (r && r.cardId === data.cardId) {
            useRevealStore.get().clearOtp(requestId);
          }
        }
        return 'card unshared';
      }
      case 'details-request': {
        const { data, peer } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string' || typeof data.cardId !== 'string') {
          return null;
        }
        if (!peer || peer.status !== 'paired') return null;
        const existing = await ctx.getRequest(data.requestId);
        if (existing) {
          // Cancel can arrive before the request itself; don't resurrect it.
          return existing.status === 'cancelled' ? 'details request already cancelled' : null;
        }
        await ctx.insertRequest({
          id: data.requestId,
          direction: 'in',
          peerId: blob.from,
          cardId: data.cardId,
          kind: 'details',
          status: 'pending',
        });
        void notify(`${peer.name} wants your card details`, 'Open Requests to approve.');
        return `details request from ${peer.name}`;
      }
      case 'otp-request': {
        const { data, peer } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string' || typeof data.cardId !== 'string') {
          return null;
        }
        if (!peer || peer.status !== 'paired') return null;
        const existing = await ctx.getRequest(data.requestId);
        if (existing) {
          return existing.status === 'cancelled' ? 'otp request already cancelled' : null;
        }
        const amount = typeof data.amount === 'string' ? data.amount : null;
        const merchant = typeof data.merchant === 'string' ? data.merchant : null;
        await ctx.insertRequest({
          id: data.requestId,
          direction: 'in',
          peerId: blob.from,
          cardId: data.cardId,
          kind: 'otp',
          amount,
          merchant,
          status: 'pending',
        });
        void notify(
          `${peer.name} requests an OTP`,
          amount ? `₹${amount}${merchant ? ` at ${merchant}` : ''} - open Requests to approve.` : 'Open Requests to approve.'
        );
        return `otp request from ${peer.name}`;
      }
      case 'details-approve': {
        const { data } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string' || typeof data.cardId !== 'string') {
          return null;
        }
        const request = await ctx.getRequest(data.requestId);
        if (
          !request ||
          request.direction !== 'out' ||
          request.status !== 'pending' ||
          request.peerId !== blob.from
        ) {
          return null;
        }
        const expiresAt =
          typeof data.expiresAt === 'number'
            ? data.expiresAt
            : Date.now() + DETAILS_WINDOW_MS;
        const details = asRecord(data.details);
        if (details && typeof details.pan === 'string') {
          await ctx.setRequestStatus(data.requestId, 'approved', expiresAt);
          useRevealStore.get().setDetails(data.cardId, details as unknown as db.CardSecrets, expiresAt);
          return 'details approved';
        }
        // No details in the blob: this was a nearby (offline) share, so the
        // full details already sit sealed on this device. The owner's
        // approval only opens the window - decrypt locally, still never
        // sending the details over the internet.
        const shared = await ctx.findSharedCard(blob.from, data.cardId);
        if (!shared?.sealed) return null;
        const sealed = await openEnvelope(shared.sealed);
        if (shared.ownerPub && !samePub(shared.ownerPub, sealed.senderPub)) return null;
        const opened = asRecord(JSON.parse(sealed.plaintext));
        const secrets = opened ? asRecord(opened.secrets) : null;
        if (
          !opened ||
          opened.cardId !== data.cardId ||
          !secrets ||
          typeof secrets.pan !== 'string'
        ) {
          return null;
        }
        await ctx.setRequestStatus(data.requestId, 'approved', expiresAt);
        useRevealStore.get().setDetails(data.cardId, secrets as unknown as db.CardSecrets, expiresAt);
        return 'details approved (offline)';
      }
      case 'details-deny': {
        const { data } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string') return null;
        const request = await ctx.getRequest(data.requestId);
        if (request && request.peerId !== blob.from) return null;
        await ctx.setRequestStatus(data.requestId, 'denied');
        return 'details denied';
      }
      case 'otp-approve': {
        const { data } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string' || typeof data.otp !== 'string') {
          return null;
        }
        const request = await ctx.getRequest(data.requestId);
        if (
          !request ||
          request.direction !== 'out' ||
          request.status !== 'pending' ||
          request.peerId !== blob.from
        ) {
          return null;
        }
        const expiresAt =
          typeof data.expiresAt === 'number'
            ? data.expiresAt
            : Date.now() + OTP_WINDOW_MS;
        await ctx.setRequestStatus(data.requestId, 'approved', expiresAt);
        useRevealStore.get().setOtp(data.requestId, data.otp, expiresAt);
        return 'otp approved';
      }
      case 'otp-deny': {
        const { data } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string') return null;
        const request = await ctx.getRequest(data.requestId);
        if (request && request.peerId !== blob.from) return null;
        await ctx.setRequestStatus(data.requestId, 'denied');
        return 'otp denied';
      }
      case 'request-cancel': {
        const { data, peer } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string') return null;
        if (!peer || peer.status !== 'paired') return null;
        const request = await ctx.getRequest(data.requestId);
        if (request) {
          if (request.peerId !== blob.from) return null;
          if (request.status === 'pending') {
            await ctx.setRequestStatus(data.requestId, 'cancelled');
          }
          return 'request cancelled';
        }
        // Request blob hasn't arrived yet: leave a tombstone so a later
        // details/otp-request with this id cannot show as pending.
        await ctx.insertRequest({
          id: data.requestId,
          direction: 'in',
          peerId: blob.from,
          cardId: typeof data.cardId === 'string' ? data.cardId : '',
          kind: data.kind === 'otp' ? 'otp' : 'details',
          status: 'cancelled',
        });
        return 'request cancelled';
      }
      case 'request-revoke': {
        const { data } = await openPeerBlob(blob, ctx);
        if (typeof data.requestId !== 'string') return null;
        const request = await ctx.getRequest(data.requestId);
        if (
          !request ||
          request.peerId !== blob.from ||
          request.status !== 'approved'
        ) {
          return null;
        }
        await ctx.setRequestStatus(data.requestId, 'revoked');
        if (request.kind === 'details') {
          useRevealStore.get().clearDetails(request.cardId);
        } else {
          useRevealStore.get().clearOtp(request.id);
        }
        return 'request revoked';
      }
      default:
        return null;
    }
  } catch (err) {
    console.error(`[relay] dropped ${blob.kind} blob:`, (err as Error).message);
    return null; // failed auth or malformed: drop silently
  }
}

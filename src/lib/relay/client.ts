import { getRelayUrl } from '../config';
import { sealTo } from '../e2e';
import { getIdentity } from '../vault';
import type { Identity } from '../identity';
import { currentPushSubscription } from '../push';
import { signRequest, signingPublicKeyHex } from '../reqsig';
import * as db from '../db';
import type { IncomingCtx } from './types';

export async function registerDevice(): Promise<void> {
  try {
    const identity = await getIdentity();
    const pushSubscription = await currentPushSubscription();
    const body = JSON.stringify({
      deviceId: identity.deviceId,
      pushToken: '',
      platform: 'web',
      signPub: await signingPublicKeyHex(identity),
      ...(pushSubscription ? { pushSubscription } : {}),
    });
    const signed = await signRequest(identity, 'POST', '/v1/devices', body);
    await fetch(`${getRelayUrl()}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signed.headers },
      body: signed.body,
    });
  } catch {
    // Offline is fine; the app retries on next poll cycle.
  }
}

export async function sendBlob(
  toDeviceId: string,
  kind: string,
  payload: object,
  ctx: Pick<IncomingCtx, 'getPeer'> = { getPeer: db.getPeer }
): Promise<string> {
  const identity = await getIdentity();
  const peer = await ctx.getPeer(toDeviceId);
  if (!peer) throw new Error(`No peer record for ${toDeviceId}`);
  const sealed = await sealTo(JSON.stringify(payload), peer.publicKey);
  return depositBlob(identity, toDeviceId, kind, sealed);
}

/**
 * Send a blob to a recipient we know the public key of but have no peer
 * record for (e.g. a nearby/offline share). The relay still delivers it to
 * their deviceId; we just seal it with the key captured at share time.
 */
export async function sendBlobToPub(
  toDeviceId: string,
  toPublicKeyHex: string,
  kind: string,
  payload: object
): Promise<string> {
  const identity = await getIdentity();
  const sealed = await sealTo(JSON.stringify(payload), toPublicKeyHex);
  return depositBlob(identity, toDeviceId, kind, sealed);
}

async function blobIdFrom(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { id?: unknown };
    return typeof data.id === 'string' ? data.id : '';
  } catch {
    return '';
  }
}

function depositError(status: number): Error {
  if (status === 404) {
    return new Error('The other device is offline. Open CardVault there and try again.');
  }
  return new Error(`Relay deposit failed: ${status}`);
}

/** Signed POST /v1/blobs with one register-and-retry on 401. */
async function depositBlob(
  identity: Identity,
  toDeviceId: string,
  kind: string,
  sealed: string
): Promise<string> {
  const body = JSON.stringify({
    to: toDeviceId,
    from: identity.deviceId,
    kind,
    payload: sealed,
  });
  const signed = await signRequest(identity, 'POST', '/v1/blobs', body);
  const res = await fetch(`${getRelayUrl()}/v1/blobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed.headers },
    body: signed.body,
  });
  if (res.status === 401) {
    // Key not bound yet (fresh vault / relay restart): register, retry once.
    await registerDevice();
    const retry = await signRequest(identity, 'POST', '/v1/blobs', body);
    const res2 = await fetch(`${getRelayUrl()}/v1/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...retry.headers },
      body: retry.body,
    });
    if (!res2.ok) throw depositError(res2.status);
    return blobIdFrom(res2);
  }
  if (!res.ok) throw depositError(res.status);
  return blobIdFrom(res);
}

/** Best-effort delete of a blob we deposited and the recipient has not picked up. */
export async function deleteRelayBlob(blobId: string): Promise<void> {
  const identity = await getIdentity();
  const path = `/v1/blobs/${blobId}`;
  const signed = await signRequest(identity, 'DELETE', path, '');
  const res = await fetch(`${getRelayUrl()}${path}`, {
    method: 'DELETE',
    headers: signed.headers,
  });
  if (res.status === 401) {
    await registerDevice();
    const retry = await signRequest(identity, 'DELETE', path, '');
    await fetch(`${getRelayUrl()}${path}`, {
      method: 'DELETE',
      headers: retry.headers,
    }).catch(() => null);
  }
}

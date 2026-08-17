import { getRelayUrl } from '../config';
import { getIdentity } from '../vault';
import { signRequest } from '../reqsig';
import { flushPendingCancels } from './actions';
import { registerDevice } from './client';
import { notifyInboxEvent } from './inbox';
import { handleIncomingBlob } from './incoming';
import { defaultCtx, type IncomingCtx } from './types';

interface RelayBlob {
  id: string;
  from: string;
  kind: string;
  payload: string;
}

async function applyBlobs(blobs: RelayBlob[], ctx: IncomingCtx): Promise<number> {
  let handled = 0;
  for (const blob of blobs) {
    const note = await handleIncomingBlob(blob, ctx);
    if (note) {
      handled += 1;
      notifyInboxEvent();
    }
  }
  return handled;
}

let applyQueue: Promise<void> = Promise.resolve();

function enqueueApply(blobs: RelayBlob[], ctx: IncomingCtx): Promise<number> {
  let handled = 0;
  const run = applyQueue.then(async () => {
    handled = await applyBlobs(blobs, ctx);
  });
  applyQueue = run.then(
    () => {},
    () => {}
  );
  return run.then(() => handled);
}

/** Fetch + apply all pending blobs for this device. Returns count handled. */
export async function pollInbox(
  ctx: IncomingCtx = defaultCtx
): Promise<number> {
  await flushPendingCancels(ctx);
  const identity = await getIdentity();
  const path = `/v1/blobs?deviceId=${identity.deviceId}`;
  const signed = await signRequest(identity, 'GET', path, '');
  const res = await fetch(`${getRelayUrl()}${path}`, {
    cache: 'no-store',
    headers: signed.headers,
  }).catch(() => null);
  if (res && res.status === 401) {
    // Device record lost (e.g. relay restart): re-register, try once more.
    await registerDevice();
    const retry = await signRequest(identity, 'GET', path, '');
    const res2 = await fetch(`${getRelayUrl()}${path}`, {
      cache: 'no-store',
      headers: retry.headers,
    }).catch(() => null);
    if (!res2 || !res2.ok) return 0;
    const data2 = (await res2.json()) as { blobs: RelayBlob[] };
    return enqueueApply(data2.blobs, ctx);
  }
  if (!res || !res.ok) return 0;
  const data = (await res.json()) as { blobs: RelayBlob[] };
  return enqueueApply(data.blobs, ctx);
}

const RETRY_GAP_MS = 3 * 1000;

let polling = false;
let pollAbort: AbortController | null = null;

/**
 * Long-poll loop: holds a relay pickup request open (?wait=1) so incoming
 * blobs are handled within a round trip instead of on a fixed poll interval.
 */
export function startPolling(): void {
  if (polling) return;
  polling = true;
  void pollLoop();
}

async function pollLoop(): Promise<void> {
  while (polling) {
    const controller = new AbortController();
    pollAbort = controller;
    try {
      await flushPendingCancels();
      const identity = await getIdentity();
      const path = `/v1/blobs?deviceId=${identity.deviceId}&wait=1`;
      const signed = await signRequest(identity, 'GET', path, '');
      const res = await fetch(`${getRelayUrl()}${path}`, {
        cache: 'no-store',
        headers: signed.headers,
        signal: controller.signal,
      });
      if (res.status === 401) {
        // Device record lost (e.g. relay restart): re-register before retry.
        await registerDevice();
        throw new Error('Relay poll unauthenticated');
      }
      if (!res.ok) throw new Error(`Relay poll failed: ${res.status}`);
      const data = (await res.json()) as { blobs: RelayBlob[] };
      await enqueueApply(data.blobs, defaultCtx);
    } catch {
      if (polling) await sleep(RETRY_GAP_MS);
    }
  }
  pollAbort = null;
}

export function stopPolling(): void {
  polling = false;
  pollAbort?.abort();
  pollAbort = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Short-lived pairing codes, resolved through the relay. Ported 1:1 from the
// native app's lib/pairing.ts. The code maps to your (public) pairing payload
// { v, deviceId, name, pub } - the exact same data the QR contains. Codes
// expire after a few minutes, so "My QR" can hand out a fresh one whenever
// someone wants to pair.

import { getRelayUrl } from './config';
import { getIdentity } from './vault';
import { signRequest } from './reqsig';

export interface PairPayload {
  v: number;
  deviceId: string;
  name: string;
  pub: string;
}

export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_MIN = 5;

/** Ask the relay to mint a fresh pairing code for this device. */
export async function createPairingCode(): Promise<string> {
  const identity = await getIdentity();
  const body = JSON.stringify({
    v: 1,
    deviceId: identity.deviceId,
    name: identity.name,
    pub: identity.pubHex,
  });
  const signed = await signRequest(identity, 'POST', '/v1/codes', body);
  const res = await fetch(`${getRelayUrl()}/v1/codes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed.headers },
    body: signed.body,
  }).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `Could not create a pairing code (relay ${res?.status ?? 'unreachable'}).`
    );
  }
  const data = (await res.json()) as { code: string };
  return data.code;
}

/** Resolve a pairing code to the owner's public pairing payload. */
export async function resolvePairingCode(code: string): Promise<PairPayload> {
  const res = await fetch(
    `${getRelayUrl()}/v1/codes/${encodeURIComponent(code.toUpperCase())}`
  ).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `That code is not valid. Pairing codes expire after ${PAIRING_CODE_TTL_MIN} minutes - ask your friend for a fresh one.`
    );
  }
  return (await res.json()) as PairPayload;
}

/** Format an 8-char code for display: XXXX-XXXX. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, PAIRING_CODE_LENGTH);
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

// Device identity: an X25519 keypair + device id + display name.
// Ported from the native app's lib/identity.ts. The secret key is held in
// memory only after unlock (it is encrypted at rest under the vault key by
// lib/vault.ts) and never leaves this device.

import nacl from 'tweetnacl';

import { bytesToHex } from './bytes';
import { sha256Hex } from './crypto';

// tweetnacl needs a CSPRNG; browsers expose crypto.getRandomValues.
nacl.setPRNG((x: Uint8Array) => {
  crypto.getRandomValues(x);
});

export interface Identity {
  deviceId: string;
  name: string;
  pubHex: string;
  secretHex: string;
}

export function generateIdentity(name?: string): Identity {
  const pair = nacl.box.keyPair();
  const deviceName = (name ?? '').trim().slice(0, 40) || 'My device';
  return {
    deviceId: crypto.randomUUID(),
    name: deviceName,
    pubHex: bytesToHex(pair.publicKey),
    secretHex: bytesToHex(pair.secretKey),
  };
}

/** The QR / clipboard payload another device scans to initiate pairing. */
export function pairingPayload(identity: Identity): string {
  return JSON.stringify({
    v: 1,
    deviceId: identity.deviceId,
    name: identity.name,
    pub: identity.pubHex,
  });
}

/**
 * Short visual fingerprint of an X25519 public key. Same algorithm as the
 * native app (`SHA-256(pubHex)` → first 8 hex chars) so mixed web/native
 * pairing can compare numbers out of band and catch a relay swapping keys.
 */
export async function pairingFingerprint(pubHex: string): Promise<string> {
  const digest = await sha256Hex(pubHex);
  return digest.slice(0, 8).toUpperCase();
}

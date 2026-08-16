// Device identity: an X25519 keypair + device id + display name.
// Ported from the native app's lib/identity.ts. The secret key is held in
// memory only after unlock (it is encrypted at rest under the vault key by
// lib/vault.ts) and never leaves this device.

import nacl from 'tweetnacl';

import { bytesToHex } from './bytes';

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

// Device-bound request signing (relay auth). Ported from the native app's
// lib/reqsig.ts; only the SHA-256 primitive differs (WebCrypto vs crypto-js).
//
// Every authenticated relay call carries an Ed25519 detached signature over a
// canonical request string. The signing seed is derived deterministically
// from this device's X25519 identity secret (no new secrets to store), and
// the derived public key is registered with the relay via POST /v1/devices.
//
// Canonical string (identical on server):
//   cardvault-req-v1\nMETHOD\npath?query\ntimestamp\nnonce\nsha256(body)

import nacl from 'tweetnacl';

import { bytesToBase64, bytesToHex, hexToBytes, randomBytes, utf8Bytes } from './bytes';
import type { Identity } from './identity';

export const SIGN_VERSION = 'cardvault-req-v1';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8Bytes(input));
  return bytesToHex(new Uint8Array(digest));
}

/** Ed25519 public key (hex) this device registers with the relay. */
export async function signingPublicKeyHex(identity: Identity): Promise<string> {
  const seed = hexToBytes(await sha256Hex(`${SIGN_VERSION}:${identity.secretHex}`));
  return bytesToHex(nacl.sign.keyPair.fromSeed(seed).publicKey);
}

export interface SignedRequest {
  body: string;
  headers: Record<string, string>;
}

/**
 * Build the exact fetch body + signature headers for one relay request.
 * `pathWithQuery` must be the path (and query) of the URL being fetched,
 * exactly as it goes on the wire.
 */
export async function signRequest(
  identity: Identity,
  method: string,
  pathWithQuery: string,
  body: string
): Promise<SignedRequest> {
  const ts = String(Date.now());
  const nonce = bytesToHex(randomBytes(16));
  const msg = utf8Bytes(
    [SIGN_VERSION, method.toUpperCase(), pathWithQuery, ts, nonce, await sha256Hex(body)].join(
      '\n'
    )
  );
  const seed = hexToBytes(await sha256Hex(`${SIGN_VERSION}:${identity.secretHex}`));
  const sig = nacl.sign.detached(msg, nacl.sign.keyPair.fromSeed(seed).secretKey);
  return {
    body,
    headers: {
      'x-cv-device': identity.deviceId,
      'x-cv-timestamp': ts,
      'x-cv-nonce': nonce,
      'x-cv-signature': bytesToBase64(sig),
    },
  };
}

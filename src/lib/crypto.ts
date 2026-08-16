// Vault cryptography (web edition).
//
// Unlike the native app (crypto-js AES-CBC + HMAC with key material held as
// JS values), the web vault uses WebCrypto exclusively:
//
//   - one AES-256-GCM master key K; at rest it exists ONLY in WRAPPED form
//     (AES-GCM under a wrap key that never touches disk); at unlock it is
//     imported non-extractable, so even an XSS during a session cannot
//     export the raw key material
//   - wrap keys: (a) PBKDF2-SHA256(passphrase, salt, 600k iterations) -
//     the recovery/primary path; (b) HKDF of the WebAuthn PRF output when a
//     passkey is enrolled (hardware-bound, keylogger-proof)
//   - each record is encrypted with a fresh random 12-byte IV; GCM provides
//     integrity, so no separate MAC layer is needed (unlike AES-CBC)
//
// Payload layout: base64( IV(12) || ciphertext+tag ).

import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  randomBytes,
  sliceBytes,
  utf8Bytes,
} from './bytes';

export const PBKDF2_ITERATIONS = 600_000;
export const GCM_IV_LENGTH = 12;
export const WRAP_KEY_LENGTH_BYTES = 32;

/**
 * WebCrypto is only exposed in secure contexts (HTTPS or localhost). Served
 * over plain HTTP on a LAN address, crypto.subtle is undefined and every
 * vault operation dies with a cryptic TypeError - fail with a clear message
 * instead.
 */
export function requireWebCrypto(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'This browser does not expose WebCrypto (crypto.subtle). CardVault must be ' +
        'served over HTTPS or localhost - open it via the https:// URL.'
    );
  }
}

/**
 * Master vault key. Extractable ONLY at creation time, because WebCrypto
 * cannot wrapKey a non-extractable key - and raw material must be wrappable
 * to survive at rest in wrapped form. After setup the reference is dropped;
 * every later unlock imports it via unwrapMasterKey with extractable:false,
 * so the session's key cannot be exported even by XSS.
 */
export async function generateMasterKey(): Promise<CryptoKey> {
  requireWebCrypto();
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/** Wrap-key from a passphrase: PBKDF2-SHA256. */
export async function derivePassphraseWrapKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Wrap-key from a WebAuthn PRF secret (32 bytes): HKDF-SHA256. */
export async function derivePrfWrapKey(prfOutput: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: utf8Bytes('cardvault-webauthn-wrap'),
      info: utf8Bytes('cardvault-v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Wrapped form of K: base64( IV || wrapped ). Safe to persist. */
export async function wrapMasterKey(
  key: CryptoKey,
  wrapKey: CryptoKey
): Promise<string> {
  const iv = randomBytes(GCM_IV_LENGTH);
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', key, wrapKey, { name: 'AES-GCM', iv })
  );
  return bytesToBase64(concatBytes(iv, wrapped));
}

export async function unwrapMasterKey(
  payload: string,
  wrapKey: CryptoKey
): Promise<CryptoKey> {
  const bytes = base64ToBytes(payload);
  if (bytes.length < GCM_IV_LENGTH + 17) throw new Error('Malformed wrapped key');
  const iv = sliceBytes(bytes, 0, GCM_IV_LENGTH);
  const ct = sliceBytes(bytes, GCM_IV_LENGTH);
  return crypto.subtle.unwrapKey(
    'raw',
    ct,
    wrapKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt a JSON-serializable value under the master key. */
export async function encryptJSON(key: CryptoKey, value: unknown): Promise<string> {
  const iv = randomBytes(GCM_IV_LENGTH);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      utf8Bytes(JSON.stringify(value))
    )
  );
  return bytesToBase64(concatBytes(iv, ct));
}

/** Decrypt a payload produced by encryptJSON. Throws on tampering. */
export async function decryptJSON<T>(key: CryptoKey, payload: string): Promise<T> {
  const bytes = base64ToBytes(payload);
  if (bytes.length < GCM_IV_LENGTH + 17) throw new Error('Malformed vault payload');
  const iv = sliceBytes(bytes, 0, GCM_IV_LENGTH);
  const ct = sliceBytes(bytes, GCM_IV_LENGTH);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** sha-256 fingerprint of a hex string (for pairing verification). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', utf8Bytes(value))
  );
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

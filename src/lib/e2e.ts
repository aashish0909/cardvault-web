// End-to-end encryption between paired devices. Ported 1:1 from the native
// app's lib/e2e.ts. tweetnacl crypto_box: X25519 key agreement + XSalsa20-
// Poly1305 authenticated encryption. Each message is a sealed envelope:
//
//   base64( JSON { senderPub, nonce, box } )
//
// The relay never sees plaintext: it cannot open a box without the recipient
// secret, and the box's auth tag proves the sender holds the matching key.

import nacl from 'tweetnacl';

import { getIdentity } from './vault';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  hexToBytes,
  utf8Bytes,
} from './bytes';

interface SealedEnvelope {
  senderPub: string; // hex
  nonce: string; // base64
  box: string; // base64
}

/** Encrypt plaintext to a recipient's public key (reads our identity). */
export async function sealTo(
  plaintext: string,
  recipientPubHex: string
): Promise<string> {
  const identity = await getIdentity();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    utf8Bytes(plaintext),
    nonce,
    hexToBytes(recipientPubHex),
    hexToBytes(identity.secretHex)
  );
  const envelope: SealedEnvelope = {
    senderPub: identity.pubHex,
    nonce: bytesToBase64(nonce),
    box: bytesToBase64(box),
  };
  return bytesToBase64(utf8Bytes(JSON.stringify(envelope)));
}

export interface OpenedEnvelope {
  plaintext: string;
  senderPub: string; // hex; authenticated by the box tag
}

/**
 * Open a sealed envelope with our own secret key. Throws if the payload is
 * not from the claimed sender or has been tampered with.
 */
export async function openEnvelope(sealedBase64: string): Promise<OpenedEnvelope> {
  const identity = await getIdentity();
  const envelope = JSON.parse(
    bytesToUtf8(base64ToBytes(sealedBase64))
  ) as SealedEnvelope;
  if (
    typeof envelope.senderPub !== 'string' ||
    typeof envelope.nonce !== 'string' ||
    typeof envelope.box !== 'string'
  ) {
    throw new Error('Malformed sealed envelope');
  }
  const opened = nacl.box.open(
    base64ToBytes(envelope.box),
    base64ToBytes(envelope.nonce),
    hexToBytes(envelope.senderPub),
    hexToBytes(identity.secretHex)
  );
  if (!opened) {
    throw new Error('Message failed authentication (wrong sender or tampered)');
  }
  return { plaintext: bytesToUtf8(opened), senderPub: envelope.senderPub };
}

export async function openFrom(sealedBase64: string): Promise<string> {
  return (await openEnvelope(sealedBase64)).plaintext;
}

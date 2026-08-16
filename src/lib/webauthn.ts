// WebAuthn passkeys (platform authenticator = Face ID / Touch ID / Windows
// Hello / fingerprint) via the PRF extension: the authenticator derives a
// device-bound 32-byte secret from (credential, eval input) that never leaves
// the hardware. That secret feeds HKDF in lib/crypto.ts to unwrap the vault
// master key - so with a passkey enrolled, unlocking is a single biometric
// prompt and the vault key is hardware-bound (keylogger-proof).
//
// The PRF eval input is generated at enrollment and reused on every unlock;
// PRF output for the same credential + input is deterministic, which is what
// makes the wrapped key reproducible. The assertion challenge can (and does)
// vary every time.
//
// Browsers without PRF support (getClientExtensionResults() has no prf) make
// passkey enrollment unavailable - the vault stays passphrase-protected.

import { bytesToBase64, base64ToBytes, randomBytes } from './bytes';

export interface PasskeyEnrollment {
  credentialId: string; // base64url
  prfInput: Uint8Array<ArrayBuffer>; // fixed per credential; reused on every unlock
  prfOutput: Uint8Array<ArrayBuffer>; // only used during enrollment; never persisted
}

function b64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isSecureContext(): boolean {
  return window.isSecureContext;
}

// WebAuthn RP IDs must be domains, not IP addresses: WebKit/Safari reject
// `rp.id = "192.168.x.x"` outright, so passkeys never enroll on a device
// browsing to the dev box over the LAN. Returns null when passkeys are
// usable, otherwise a human-readable reason.
export function passkeySupportIssue(): string | null {
  if (!isSecureContext()) {
    return 'Passkeys require a secure context (HTTPS).';
  }
  if (typeof window.PublicKeyCredential === 'undefined') {
    return 'This browser does not support WebAuthn passkeys.';
  }
  const hostname = location.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return (
      'Passkeys need a real domain name - the browser rejects IP addresses like ' +
      `${hostname}. Open the app at a tunneled https:// URL (e.g. a Cloudflare ` +
      'Tunnel) to use biometric unlock.'
    );
  }
  return null;
}

// Some environments (embedded webviews, headless browsers) hold the
// credentials promise pending forever instead of rejecting. Never let an
// enrollment or assertion block the app: bail out after a timeout and treat
// it as "passkey unavailable" (the vault stays passphrase-protected). The
// timeout is generous - the iOS passkey sheet + Face ID prompt can take a
// while on first use.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('passkey timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Create a platform passkey with PRF enabled. Returns null when PRF is not
 * supported (no `prf` result in the extension output) - in that case no
 * enrollment happens and the vault remains passphrase-protected.
 */
export async function createPasskey(
  displayName: string,
  prfInput: Uint8Array<ArrayBuffer>
): Promise<PasskeyEnrollment | null> {
  if (!isSecureContext() || !window.PublicKeyCredential) return null;
  try {
    const credential = (await withTimeout(
      navigator.credentials.create({
        publicKey: {
          rp: { id: location.hostname, name: 'CardVault' },
          user: {
            id: randomBytes(16),
            name: displayName,
            displayName,
          },
          challenge: randomBytes(32),
          // Chrome requires ES256 and RS256 in this list; omitting either
          // warns and can fail registration on Windows Hello / older authenticators.
          // https://chromium.googlesource.com/chromium/src/+/main/content/browser/webauth/pub_key_cred_params.md
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 }, // ES256
            { type: 'public-key', alg: -257 }, // RS256
            { type: 'public-key', alg: -8 }, // Ed25519
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'required',
            userVerification: 'required',
          },
          extensions: {
            prf: { eval: { first: prfInput } },
          },
        },
      }) as Promise<PublicKeyCredential | null>,
      60_000
    ));
    if (!credential) return null;
    const prfResult = credential
      .getClientExtensionResults()
      .prf?.results?.first as ArrayBuffer | undefined;
    if (!prfResult) return null;
    return {
      credentialId: b64url(new Uint8Array(credential.rawId)),
      prfInput,
      prfOutput: new Uint8Array(prfResult),
    };
  } catch {
    return null;
  }
}

/**
 * Biometric prompt that recovers the PRF secret. Returns null on cancel /
 * failure or when PRF output is unavailable.
 */
export async function assertPasskey(
  credentialIdBase64url: string,
  prfInput: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer> | null> {
  const b64 = credentialIdBase64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const credentialId = base64ToBytes(padded);
  try {
    const assertion = (await withTimeout(
      navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: [{ type: 'public-key', id: credentialId }],
          userVerification: 'required',
          extensions: {
            prf: { eval: { first: prfInput } },
          },
        },
      }) as Promise<PublicKeyCredential | null>,
      60_000
    ));
    if (!assertion) return null;
    const extResults = assertion.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer | null } } | null;
    };
    const prfResult = extResults.prf?.results?.first as ArrayBuffer | undefined;
    if (!prfResult) {
      console.warn('[webauthn] assertion returned no PRF output', extResults);
      return null;
    }
    return new Uint8Array(prfResult);
  } catch (err) {
    console.error('[webauthn] assertPasskey failed:', err);
    return null;
  }
}

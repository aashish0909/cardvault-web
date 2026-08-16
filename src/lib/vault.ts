// Vault session management: setup, unlock, lock, and in-memory secrets.
//
// Threat model (web): an XSS can read anything the page can read. So at rest
// nothing usable exists: the master key K is non-extractable and only stored
// WRAPPED, and wrap keys live in the passphrase and the passkey hardware.
// After unlock, plaintext secrets exist in memory by definition - the
// protections at that point are CSP, auto-lock on blur/idle, and the reveal
// windows being memory-only (lib/reveal.ts).

import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
} from './bytes';
import {
  decryptJSON,
  derivePassphraseWrapKey,
  derivePrfWrapKey,
  encryptJSON,
  generateMasterKey,
  unwrapMasterKey,
  wrapMasterKey,
} from './crypto';
import { generateIdentity, type Identity } from './identity';
import { clearAllStores, closeDb, DB_NAME, kvDelete, kvGet, kvSet } from './db';
import { useRevealStore } from './reveal';
import {
  assertPasskey,
  createPasskey,
  type PasskeyEnrollment,
} from './webauthn';

const KV_SALT = 'vault.salt';
const KV_WRAPPED = 'vault.wrapped';
const KV_WRAPPED_PRF = 'vault.wrapped-prf';
const KV_PRF_INPUT = 'vault.prf-input';
const KV_PASSKEY_ID = 'vault.passkey-id';
const KV_IDENTITY = 'identity.v1';

export const MIN_PASSPHRASE_LENGTH = 12;

/** User-facing reason the passphrase is too weak, or null if it is acceptable. */
export function passphraseIssue(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  if (/^\s+$/.test(passphrase)) {
    return 'Passphrase cannot be only whitespace.';
  }
  if (/^[0-9]+$/.test(passphrase)) {
    return 'Passphrase cannot be only digits.';
  }
  return null;
}

let unlockFails = 0;
let unlockLockedUntil = 0;

/** Milliseconds remaining before another passphrase attempt is allowed. */
export function unlockBackoffMs(): number {
  return Math.max(0, unlockLockedUntil - Date.now());
}

function recordUnlockFailure(): void {
  unlockFails += 1;
  if (unlockFails >= 3) {
    const delay = Math.min(30_000, 1000 * 2 ** (unlockFails - 3));
    unlockLockedUntil = Date.now() + delay;
  }
}

function clearUnlockFailures(): void {
  unlockFails = 0;
  unlockLockedUntil = 0;
}

interface Session {
  key: CryptoKey;
  identity: Identity;
}

let session: Session | null = null;

export function isUnlocked(): boolean {
  return session !== null;
}

export type VaultStatus = 'empty' | 'locked' | 'unlocked';

export async function vaultStatus(): Promise<VaultStatus> {
  if (session) return 'unlocked';
  const wrapped = await kvGet(KV_WRAPPED);
  return wrapped ? 'locked' : 'empty';
}

export async function passkeyEnabled(): Promise<boolean> {
  return (await kvGet(KV_PASSKEY_ID)) !== null;
}

export function hasPasskeyCredentials(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof (navigator as unknown as { credentials: CredentialsContainer }).credentials.get === 'function'
  );
}

/** First-run: create the master key, wrap it under the passphrase, store. */
export async function setupVault(options: {
  passphrase: string;
  displayName: string;
  passkey: PasskeyEnrollment | null;
}): Promise<void> {
  const weak = passphraseIssue(options.passphrase);
  if (weak) throw new Error(weak);
  const key = await generateMasterKey();
  const salt = randomBytes(16);
  const wrapKey = await derivePassphraseWrapKey(options.passphrase, salt);
  const wrapped = await wrapMasterKey(key, wrapKey);
  const identity = generateIdentity(options.displayName);
  const identityPayload = await encryptJSON(key, identity);

  await kvSet(KV_SALT, bytesToBase64(salt));
  await kvSet(KV_WRAPPED, wrapped);
  await kvSet(KV_IDENTITY, identityPayload);

  if (options.passkey) {
    // Wrapping cannot fail silently: the vault would look passkey-enabled
    // while unlock would break. Let any failure abort setup.
    await wrapPasskey(options.passkey, key);
  }

  session = { key, identity };
}

/** Prompt the user to register a biometric passkey, ahead of vault setup.
 * Returns null when the user cancels or PRF is unavailable. */
export async function createPasskeyEnrollment(
  displayName: string
): Promise<PasskeyEnrollment | null> {
  const prfInput = randomBytes(32);
  return createPasskey(displayName, prfInput);
}

async function wrapPasskey(
  enrollment: PasskeyEnrollment,
  key: CryptoKey
): Promise<void> {
  const wrapKey = await derivePrfWrapKey(enrollment.prfOutput);
  const wrappedPrf = await wrapMasterKey(key, wrapKey);
  await kvSet(KV_PRF_INPUT, bytesToBase64(enrollment.prfInput));
  await kvSet(KV_PASSKEY_ID, enrollment.credentialId);
  await kvSet(KV_WRAPPED_PRF, wrappedPrf);
}

/** Enroll a passkey and re-wrap the vault key under the PRF-derived key.
 * Used from Profile to enable biometric unlock on an existing vault. */
export async function enrollPasskey(key: CryptoKey = session?.key as CryptoKey): Promise<boolean> {
  if (!key) return false;
  const enrollment = await createPasskeyEnrollment(session?.identity.name ?? 'CardVault');
  if (!enrollment) return false;
  try {
    await wrapPasskey(enrollment, key);
    return true;
  } catch (err) {
    console.error('[vault] passkey enrollment failed:', err);
    return false;
  }
}

/** Single biometric-prompt unlock (passkey enrolled). */
/** Single biometric-prompt unlock (passkey enrolled). Returns null on success,
 * or a user-facing failure reason. */
export async function unlockWithPasskey(): Promise<string | null> {
  const prfInputB64 = await kvGet(KV_PRF_INPUT);
  const credentialId = await kvGet(KV_PASSKEY_ID);
  const wrappedPrf = await kvGet(KV_WRAPPED_PRF);
  if (!prfInputB64 || !credentialId || !wrappedPrf) return 'Passkey not fully enrolled.';
  try {
    const prfOutput = await assertPasskey(credentialId, base64ToBytes(prfInputB64));
    if (!prfOutput) {
      console.warn('[vault] passkey assertion produced no PRF output');
      return 'Biometric prompt completed but no key material was returned.';
    }
    const wrapKey = await derivePrfWrapKey(prfOutput);
    const key = await unwrapMasterKey(wrappedPrf, wrapKey);
    await openSession(key);
    return null;
  } catch (err) {
    console.error('[vault] passkey unlock failed:', err);
    return (err as Error).message || 'Biometric unlock failed.';
  }
}

/** Passphrase unlock (PBKDF2). Also the recovery path when passkeys break. */
export async function unlockWithPassphrase(passphrase: string): Promise<boolean> {
  if (unlockBackoffMs() > 0) return false;
  const saltB64 = await kvGet(KV_SALT);
  const wrapped = await kvGet(KV_WRAPPED);
  if (!saltB64 || !wrapped) return false;
  try {
    const wrapKey = await derivePassphraseWrapKey(passphrase, base64ToBytes(saltB64));
    const key = await unwrapMasterKey(wrapped, wrapKey);
    await openSession(key);
    clearUnlockFailures();
    return true;
  } catch {
    recordUnlockFailure();
    return false;
  }
}

async function openSession(key: CryptoKey): Promise<void> {
  const payload = await kvGet(KV_IDENTITY);
  if (!payload) throw new Error('Vault is missing its identity record');
  const identity = await decryptJSON<Identity>(key, payload);
  session = { key, identity };
}

/** Wipe all in-memory secrets. The reveal windows die with the session. */
export function lockVault(): void {
  session = null;
  const reveal = useRevealStore.get();
  for (const cardId of Object.keys(reveal.details)) reveal.clearDetails(cardId);
  for (const requestId of Object.keys(reveal.otp)) reveal.clearOtp(requestId);
}

/** Persist a new display name (encrypted at rest). */
export async function updateIdentityName(name: string): Promise<Identity> {
  const s = requireSession();
  const next: Identity = { ...s.identity, name: name.trim().slice(0, 40) || 'My device' };
  await kvSet(KV_IDENTITY, await encryptJSON(s.key, next));
  s.identity = next;
  return next;
}

/** The current device identity - only available while unlocked. */
export async function getIdentity(): Promise<Identity> {
  return requireSession().identity;
}

export async function getSessionKey(): Promise<CryptoKey> {
  return requireSession().key;
}

function requireSession(): Session {
  if (!session) throw new Error('Vault is locked');
  return session;
}

/** Nuke everything: wrapped key, identity, cards, peers, requests. */
export async function wipeVault(): Promise<void> {
  session = null;
  for (const k of [KV_SALT, KV_WRAPPED, KV_WRAPPED_PRF, KV_PRF_INPUT, KV_PASSKEY_ID, KV_IDENTITY]) {
    await kvDelete(k);
  }
  await clearAllStores();
  closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

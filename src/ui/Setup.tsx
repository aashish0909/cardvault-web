// First-run vault setup: passphrase + (optional) passkey enrollment.
// Ticking the biometric checkbox triggers the passkey registration prompt
// right away; on cancel/failure the box unchecks and setup continues with
// passphrase only. The registered credential is bound to the vault at
// creation (setupVault wraps the master key under the PRF secret).

import { useState } from 'react';

import { createPasskeyEnrollment, setupVault } from '../lib/vault';
import { passkeySupportIssue } from '../lib/webauthn';
import type { PasskeyEnrollment } from '../lib/webauthn';

export default function Setup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [usePasskey, setUsePasskey] = useState(false);
  const [enrollment, setEnrollment] = useState<PasskeyEnrollment | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeyIssue = passkeySupportIssue();

  const togglePasskey = async (checked: boolean) => {
    setError(null);
    if (!checked) {
      setEnrollment(null);
      return;
    }
    setEnrolling(true);
    try {
      const e = await createPasskeyEnrollment(name.trim() || 'CardVault');
      if (!e) {
        setUsePasskey(false);
        setError('Biometric registration was cancelled or is not supported. You can still create the vault with your passphrase.');
      } else {
        setEnrollment(e);
      }
    } finally {
      setEnrolling(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 1) return setError('Enter a display name for this device.');
    if (pass.length < 8) return setError('Passphrase must be at least 8 characters.');
    if (pass !== confirm) return setError('Passphrases do not match.');
    setBusy(true);
    try {
      await setupVault({
        passphrase: pass,
        displayName: name.trim(),
        passkey: usePasskey && !passkeyIssue ? enrollment : null,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="panel" onSubmit={submit}>
        <div className="brand">
          Card<span>Vault</span>
        </div>
        <p className="muted">
          Your cards are encrypted on this device. This passphrase is the only
          way to decrypt them - write it down. There is no recovery.
        </p>
        <div className="field section-gap">
          <label htmlFor="name">Device name (shown to friends)</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={40}
          />
        </div>
        <div className="field">
          <label htmlFor="pass">Passphrase</label>
          <input
            id="pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm passphrase</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={usePasskey && !passkeyIssue}
            disabled={!!passkeyIssue || enrolling}
            onChange={(e) => {
              setUsePasskey(e.target.checked);
              void togglePasskey(e.target.checked);
            }}
            style={{ width: 'auto' }}
          />
          <span>{enrolling ? 'Registering biometrics…' : 'Unlock with biometrics (passkey)'}</span>
        </label>
        {passkeyIssue && (
          <p className="muted" style={{ fontSize: '0.85em' }}>
            {passkeyIssue} You can still unlock with your passphrase.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Creating vault…' : 'Create vault'}
        </button>
      </form>
    </div>
  );
}

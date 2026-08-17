// Vault unlock: passkey (biometric) when enrolled, passphrase otherwise.

import { useEffect, useState } from 'react';

import {
  passkeyEnabled,
  unlockBackoffMs,
  unlockWithPassphrase,
  unlockWithPasskey,
} from '../../lib/vault';

export default function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [passkey, setPasskey] = useState(false);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [triedPasskey, setTriedPasskey] = useState(false);
  const [waitMs, setWaitMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void passkeyEnabled().then((v) => {
      if (!cancelled) setPasskey(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (waitMs <= 0) return;
    const t = window.setInterval(() => setWaitMs(unlockBackoffMs()), 250);
    return () => window.clearInterval(t);
  }, [waitMs]);

  const unlockBiometric = async () => {
    setBusy(true);
    setError(null);
    const reason = await unlockWithPasskey();
    setBusy(false);
    if (!reason) {
      onUnlocked();
    } else {
      setError(reason);
      setTriedPasskey(true);
    }
  };

  const unlockPass = async (e: React.FormEvent) => {
    e.preventDefault();
    const remaining = unlockBackoffMs();
    if (remaining > 0) {
      setWaitMs(remaining);
      setError(`Too many attempts. Try again in ${Math.ceil(remaining / 1000)}s.`);
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await unlockWithPassphrase(pass);
    setBusy(false);
    if (ok) {
      onUnlocked();
      return;
    }
    const nextWait = unlockBackoffMs();
    setWaitMs(nextWait);
    setError(
      nextWait > 0
        ? `Wrong passphrase. Try again in ${Math.ceil(nextWait / 1000)}s.`
        : 'Wrong passphrase.'
    );
  };

  return (
    <div className="center-screen">
      <div className="panel">
        <div className="brand">
          Card<span>Vault</span>
        </div>
        <p className="muted">Vault locked.</p>
        {passkey && !triedPasskey && (
          <button
            className="btn btn-primary btn-block section-gap"
            onClick={unlockBiometric}
            disabled={busy}
          >
            {busy ? 'Unlocking…' : 'Unlock with biometrics'}
          </button>
        )}
        {(!passkey || triedPasskey) && (
          <form onSubmit={unlockPass}>
            <div className="field section-gap">
              <label htmlFor="unlock-pass">Passphrase</label>
              <input
                id="unlock-pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error && <p className="error">{error}</p>}
            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={busy || waitMs > 0}
            >
              {waitMs > 0 ? `Wait ${Math.ceil(waitMs / 1000)}s` : 'Unlock'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

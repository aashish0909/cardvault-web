// App shell: vault status state machine (empty | locked | unlocked), the
// relay polling lifecycle, inactivity locking, and toast rendering.
//
// The vault remains available while the user switches tabs or windows. It is
// locked after five minutes without activity, or when the page is closed.

import { useEffect, useState } from 'react';

import { lockVault, vaultStatus, type VaultStatus } from './lib/vault';
import { requireWebCrypto } from './lib/crypto';
import { pollInbox, registerDevice, startPolling, stopPolling } from './lib/relay';
import { setupPush } from './lib/push';
import { useToasts } from './lib/notify';
import Setup from './ui/Setup';
import Unlock from './ui/Unlock';
import Main from './ui/Main';

export const IDLE_LOCK_MS = 5 * 60 * 1000;

export default function App() {
  const [status, setStatus] = useState<VaultStatus | 'loading'>('loading');
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      requireWebCrypto();
      void vaultStatus().then((s) => {
        if (!cancelled) setStatus(s);
      });
    } catch (err) {
      if (!cancelled) {
        setCryptoError((err as Error).message);
        setStatus('locked');
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling only while unlocked. Refresh web-push only if already granted —
  // iOS will permanently deny if we prompt without a tap.
  useEffect(() => {
    if (status !== 'unlocked') {
      stopPolling();
      return;
    }
    startPolling();
    void (async () => {
      await registerDevice();
      await setupPush();
      await pollInbox().catch(() => {});
    })();
    return () => stopPolling();
  }, [status]);

  // Auto-lock after inactivity or when the page is being closed/navigated away.
  useEffect(() => {
    if (status !== 'unlocked') return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const lock = () => {
      lockVault();
      setStatus('locked');
    };
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(lock, IDLE_LOCK_MS);
    };
    const onPageHide = lock;
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, resetIdle, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    resetIdle();
    return () => {
      for (const e of events) window.removeEventListener(e, resetIdle);
      window.removeEventListener('pagehide', onPageHide);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [status]);

  return (
    <div className="app">
      <div className="screen-fade">
        {cryptoError ? (
          <div className="center-screen">
            <div className="panel">
              <div className="brand">
                Card<span>Vault</span>
              </div>
              <p className="error">{cryptoError}</p>
              <p className="muted">
                WebCrypto is only available in secure contexts. If you are
                viewing over http:// on a LAN address, open the page at
                https://localhost:{window.location.port ?? ''} or host it over
                HTTPS.
              </p>
            </div>
          </div>
        ) : status === 'loading' ? null : status === 'empty' ? (
          <Setup onDone={() => setStatus('unlocked')} />
        ) : status === 'locked' ? (
          <Unlock onUnlocked={() => setStatus('unlocked')} />
        ) : (
          <Main onLocked={() => setStatus('locked')} />
        )}
      </div>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <div className="toast-title">{t.title}</div>
          <div className="toast-body">{t.body}</div>
        </div>
      ))}
    </div>
  );
}

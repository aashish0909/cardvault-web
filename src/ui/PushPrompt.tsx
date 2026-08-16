// In-app prompt so iPhone users actually grant Web Push. iOS only delivers
// banners to a Home Screen PWA, and only after a tap-triggered permission.

import { useEffect, useState } from 'react';

import {
  isIOS,
  isStandalonePwa,
  pushPermission,
  requestPush,
} from '../lib/push';

type Kind = 'hidden' | 'enable' | 'install' | 'blocked';

const DISMISS_KEY = 'cv-push-prompt-dismissed';

export default function PushPrompt() {
  const [kind, setKind] = useState<Kind>('hidden');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () => {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY)) {
        setKind('hidden');
        return;
      }
      const perm = pushPermission();
      if (perm === 'granted') {
        setKind('hidden');
        return;
      }
      if (isIOS() && !isStandalonePwa()) {
        setKind('install');
        return;
      }
      if (perm === 'denied') {
        setKind('blocked');
        return;
      }
      if (perm === 'unsupported') {
        setKind('hidden');
        return;
      }
      setKind('enable');
    };
    refresh();
    window.addEventListener('cv-push-changed', refresh);
    return () => window.removeEventListener('cv-push-changed', refresh);
  }, []);

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // private mode
    }
    setKind('hidden');
  };

  const enable = async () => {
    setBusy(true);
    const ok = await requestPush();
    setBusy(false);
    if (ok) setKind('hidden');
  };

  if (kind === 'hidden') return null;

  return (
    <div className="push-prompt" role="status">
      {kind === 'install' && (
        <>
          <p>
            Add CardVault to your Home Screen to get alerts when a friend requests
            details or an OTP — even if this app is closed.
          </p>
          <p className="muted">Safari → Share → Add to Home Screen, then open the icon and enable notifications.</p>
        </>
      )}
      {kind === 'enable' && (
        <p>
          Turn on notifications so requests reach you while CardVault is in the
          background or closed.
        </p>
      )}
      {kind === 'blocked' && (
        <p>
          Notifications are blocked. Enable them in Settings → Notifications →
          CardVault, then reopen the app.
        </p>
      )}
      <div className="push-prompt-actions">
        {kind === 'enable' && (
          <button className="btn btn-primary" onClick={() => void enable()} disabled={busy}>
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}
        <button className="btn btn-ghost" onClick={dismiss}>
          Later
        </button>
      </div>
    </div>
  );
}

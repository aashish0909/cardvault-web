// Install / notification banners.
//
// iOS Home Screen apps have their own storage, separate from Safari. Prompting
// "Add to Home Screen" *after* vault creation is how people lose the vault they
// just made. Setup shows the install banner first; after unlock we only ask
// for notification permission (which iOS only grants in the installed app).

import { useEffect, useState } from 'react';

import { useAppInstall } from '../../lib/install';
import {
  currentPushSubscription,
  isIOS,
  isStandalonePwa,
  pushPermission,
  requestPush,
} from '../../lib/push';

type Kind = 'hidden' | 'enable' | 'install' | 'blocked';
type Phase = 'setup' | 'unlocked';

const PUSH_DISMISS_KEY = 'cv-push-prompt-dismissed';
const INSTALL_DISMISS_KEY = 'cv-install-prompt-dismissed';

export default function PushPrompt({ phase = 'unlocked' }: { phase?: Phase }) {
  const [kind, setKind] = useState<Kind>('hidden');
  const [busy, setBusy] = useState(false);
  const install = useAppInstall();

  useEffect(() => {
    const refresh = () => {
      if (phase === 'setup') {
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(INSTALL_DISMISS_KEY)) {
          setKind('hidden');
          return;
        }
        if (install.installed || isStandalonePwa()) {
          setKind('hidden');
          return;
        }
        if ((isIOS() && !isStandalonePwa()) || install.canPrompt) {
          setKind('install');
          return;
        }
        setKind('hidden');
        return;
      }

      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(PUSH_DISMISS_KEY)) {
        setKind('hidden');
        return;
      }
      const perm = pushPermission();
      if (perm === 'granted') {
        void currentPushSubscription().then((sub) => {
          if (!sub) setKind('enable');
          else setKind('hidden');
        });
        return;
      }
      if (perm === 'denied') {
        setKind('blocked');
        return;
      }
      if (perm === 'unsupported' || (isIOS() && !isStandalonePwa())) {
        setKind('hidden');
        return;
      }
      setKind('enable');
    };
    refresh();
    window.addEventListener('cv-push-changed', refresh);
    return () => window.removeEventListener('cv-push-changed', refresh);
  }, [phase, install.installed, install.canPrompt]);

  const dismiss = () => {
    try {
      sessionStorage.setItem(phase === 'setup' ? INSTALL_DISMISS_KEY : PUSH_DISMISS_KEY, '1');
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

  const addAsApp = async () => {
    setBusy(true);
    await install.promptInstall();
    setBusy(false);
  };

  if (kind === 'hidden') return null;

  return (
    <div className="push-prompt" role="status">
      {kind === 'install' && (
        <>
          <p>
            Add CardVault as an app before creating a vault. A home-screen app
            has its own storage — installing after setup starts a new empty vault.
          </p>
          {isIOS() ? (
            <p className="muted">
              Safari → Share → Add to Home Screen, then open the icon and create
              your vault there.
            </p>
          ) : (
            <p className="muted">Install the app, then create your vault in it.</p>
          )}
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
        {kind === 'install' && install.canPrompt && (
          <button className="btn btn-primary" onClick={() => void addAsApp()} disabled={busy}>
            {busy ? 'Adding…' : 'Add as an app'}
          </button>
        )}
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

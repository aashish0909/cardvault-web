// Profile tab: identity name, passkey enrollment, lock, wipe.

import { useEffect, useState } from 'react';

import type { Identity } from '../lib/identity';
import { useAppInstall } from '../lib/install';
import { currentPushSubscription, pushPermission, requestPush, sendTestPush } from '../lib/push';
import { passkeySupportIssue } from '../lib/webauthn';
import { sendNameUpdate } from '../lib/relay';
import {
  enrollPasskey,
  getIdentity,
  passkeyEnabled,
  updateIdentityName,
  wipeVault,
} from '../lib/vault';

export default function ProfileTab({ onLock }: { onLock: () => void }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [name, setName] = useState('');
  const [passkey, setPasskey] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >('unsupported');
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const install = useAppInstall();

  const reload = async () => {
    const id = await getIdentity();
    setIdentity(id);
    setName(id.name);
    setPasskey(await passkeyEnabled());
  };

  useEffect(() => {
    void reload();
    const refreshPush = () => {
      setNotificationPermission(pushPermission());
      void currentPushSubscription().then((sub) => setPushSubscribed(Boolean(sub)));
    };
    refreshPush();
    window.addEventListener('cv-push-changed', refreshPush);
    return () => window.removeEventListener('cv-push-changed', refreshPush);
  }, []);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity) return;
    if (name.trim() === identity.name) return;
    const next = await updateIdentityName(name);
    setIdentity(next);
    await sendNameUpdate(next.name).catch(() => {});
    setNote('Name updated.');
  };

  const enablePasskey = async () => {
    setNote(null);
    const issue = passkeySupportIssue();
    if (issue) {
      setNote(issue);
      return;
    }
    const ok = await enrollPasskey();
    setPasskey(await passkeyEnabled());
    setNote(ok ? 'Biometric unlock enabled.' : 'Passkeys are not available in this browser.');
  };

  const enableNotifications = async () => {
    const enabled = await requestPush();
    setNotificationPermission(pushPermission());
    setPushSubscribed(Boolean(await currentPushSubscription()) && enabled);
    setNote(enabled ? 'Notifications enabled.' : 'Notifications could not be enabled.');
  };

  const testNotifications = async () => {
    setTestingPush(true);
    const ok = await sendTestPush();
    setTestingPush(false);
    setNote(
      ok
        ? 'Test sent. Lock the phone or switch apps — a CardVault banner should appear.'
        : 'Test failed. Enable notifications, then try again.'
    );
  };

  const wipe = async () => {
    try {
      await wipeVault();
      location.reload();
    } catch {
      setNote('Wipe failed. Close other tabs of this app and try again.');
    }
  };

  if (!identity) return null;

  return (
    <div className="screen">
      <h1>Profile</h1>

      <h2 className="section-gap">Device</h2>
      <form onSubmit={saveName}>
        <div className="field">
          <label htmlFor="dev-name">Display name (shown to friends)</label>
          <input
            id="dev-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
          />
        </div>
        <button className="btn" type="submit">
          Save name
        </button>
      </form>
      <p className="muted">Device id: {identity.deviceId.slice(0, 12)}…</p>

      <h2 className="section-gap">Notifications</h2>
      {notificationPermission === 'unsupported' ? (
        <p className="muted">Push notifications are not supported in this browser.</p>
      ) : notificationPermission === 'denied' ? (
        <p className="muted">Notifications are blocked. Allow them in Settings → Notifications → CardVault.</p>
      ) : notificationPermission === 'granted' && pushSubscribed ? (
        <>
          <p className="muted">Alerts are on. You will be pinged even when CardVault is closed.</p>
          <button className="btn" onClick={() => void testNotifications()} disabled={testingPush}>
            {testingPush ? 'Sending…' : 'Send test notification'}
          </button>
        </>
      ) : (
        <button className="btn" onClick={() => void enableNotifications()}>
          Enable notifications
        </button>
      )}

      <h2 className="section-gap">Unlock</h2>
      {passkey ? (
        <p className="muted">Biometric (passkey) unlock is enabled.</p>
      ) : (
        <button className="btn" onClick={() => void enablePasskey()}>
          Enable biometric unlock
        </button>
      )}

      {note && <p className="muted">{note}</p>}

      <h2 className="section-gap">App</h2>
      {install.canPrompt ? (
        <button className="btn" onClick={() => void install.promptInstall()}>
          Install app
        </button>
      ) : install.installed ? (
        <p className="muted">Running as an installed app.</p>
      ) : install.isIOS ? (
        <p className="muted">
          iOS home-screen apps cannot see this vault. Add to Home Screen before
          creating a vault, then set up inside the app.
        </p>
      ) : (
        <p className="muted">Installable once you open this site over HTTPS.</p>
      )}

      <h2 className="section-gap">Security</h2>
      <button className="btn btn-danger btn-block" onClick={onLock}>
        Lock now
      </button>

      <div className="section-gap">
        {confirmWipe ? (
          <>
            <p className="error">
              This permanently deletes this vault from this browser. There is no recovery.
            </p>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setConfirmWipe(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void wipe()}>
                Delete everything
              </button>
            </div>
          </>
        ) : (
          <button className="btn btn-danger btn-block" onClick={() => setConfirmWipe(true)}>
            Wipe this vault
          </button>
        )}
      </div>
    </div>
  );
}

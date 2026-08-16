// Web Push client: subscribes this device's browser to the relay's push
// endpoint so OTP/details requests still surface as OS notifications while
// the app is closed. Delivery is a no-op on the relay unless the recipient
// has no live long-poll waiter (i.e. the app is closed or locked).

import { getRelayUrl } from './config';
import { getIdentity } from './vault';
import { signRequest, signingPublicKeyHex } from './reqsig';

interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let active: Promise<boolean> | null = null;

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function setupPush(): Promise<boolean> {
  if (active) return active;
  active = (async () => {
    if (pushPermission() === 'unsupported') return false;
    if (Notification.permission !== 'granted') {
      if ((await Notification.requestPermission()) !== 'granted') return false;
    }
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${getRelayUrl()}/v1/push/vapid`).catch(() => null);
    if (!keyRes || !keyRes.ok) return false;
    const { publicKey } = (await keyRes.json()) as { publicKey?: string };
    if (!publicKey) return false;
    const options = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    };
    let sub: PushSubscription;
    try {
      sub = await reg.pushManager.subscribe(options);
    } catch (err) {
      if ((err as DOMException).name !== 'InvalidStateError') throw err;
      const old = await reg.pushManager.getSubscription();
      if (!old) throw err;
      await old.unsubscribe();
      sub = await reg.pushManager.subscribe(options);
    }
    const identity = await getIdentity();
    const json = sub.toJSON() as unknown as PushSubscriptionJSON;
    const body = JSON.stringify({
      deviceId: identity.deviceId,
      pushToken: '',
      platform: 'web',
      signPub: await signingPublicKeyHex(identity),
      pushSubscription: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      },
    });
    const signed = await signRequest(identity, 'POST', '/v1/devices', body);
    const res = await fetch(`${getRelayUrl()}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signed.headers },
      body: signed.body,
    });
    return res.ok;
  })()
    .catch(() => false)
    .finally(() => {
      active = null;
    });
  return active;
}

// Web Push client: subscribes this device's browser to the relay's push
// endpoint so OTP/details requests still surface as OS notifications while
// the app is closed. Delivery is a no-op on the relay unless the recipient
// has a stored subscription.
//
// iOS: requestPermission() MUST be tied to a tap. Calling it on unlock
// (no user gesture) can permanently deny notifications. Unlock only refreshes
// an existing grant via setupPush(); the banner/button calls requestPush().

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

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function currentPushSubscription(): Promise<PushSubscriptionJSON | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const json = sub.toJSON() as unknown as PushSubscriptionJSON;
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
    return json;
  } catch {
    return null;
  }
}

async function postSubscription(sub: PushSubscriptionJSON): Promise<boolean> {
  const identity = await getIdentity();
  const body = JSON.stringify({
    deviceId: identity.deviceId,
    pushToken: '',
    platform: 'web',
    signPub: await signingPublicKeyHex(identity),
    pushSubscription: {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    },
  });
  const signed = await signRequest(identity, 'POST', '/v1/devices', body);
  const res = await fetch(`${getRelayUrl()}/v1/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed.headers },
    body: signed.body,
  });
  return res.ok;
}

/** Refresh an existing grant. Never prompts. Safe to call on unlock. */
export function setupPush(): Promise<boolean> {
  return setupPushInternal({ request: false });
}

/** Prompt (user gesture) then subscribe. Call only from a tap handler. */
export function requestPush(): Promise<boolean> {
  return setupPushInternal({ request: true });
}

function setupPushInternal(opts: { request: boolean }): Promise<boolean> {
  if (active) return active;
  active = (async () => {
    if (pushPermission() === 'unsupported') return false;
    if (Notification.permission !== 'granted') {
      if (!opts.request) return false;
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
    const json = sub.toJSON() as unknown as PushSubscriptionJSON;
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    const posted = await postSubscription(json);
    if (posted && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('cv-push-changed'));
    }
    return posted;
  })()
    .catch((err) => {
      console.warn('[push] subscribe failed:', (err as Error).message);
      return false;
    })
    .finally(() => {
      active = null;
    });
  return active;
}

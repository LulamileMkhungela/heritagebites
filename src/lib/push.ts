/**
 * Browser side of Web Push.
 *
 * Kept deliberately small and honest: every failure path returns a sentence a
 * customer can act on, because the alternative — a button that looks like it
 * worked while the browser quietly refused — is worse than no button.
 *
 * No third-party SDK: the browser's own Push API plus a service worker is the
 * whole mechanism, which is why this channel costs nothing.
 */

import { BASE_URL, STATIC_PREVIEW } from './api';

export type PushState =
  | { status: 'unsupported'; message: string }
  | { status: 'unconfigured'; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'idle'; message: string }
  | { status: 'subscribed'; message: string };

interface PushConfigResponse {
  enabled: boolean;
  vapidPublicKey: string | null;
  ownerEnrolment: boolean;
}

/** The service worker lives at the site root so its scope covers every route. */
const workerUrl = `${BASE_URL.replace(/\/$/, '')}/sw.js`;

export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS only delivers push to a site that has been added to the home screen. */
export function isIosWithoutInstall(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}

async function getConfig(): Promise<PushConfigResponse | null> {
  if (STATIC_PREVIEW) return null;
  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api/push/config`);
    if (!res.ok) return null;
    return (await res.json()) as PushConfigResponse;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  /* Explicitly backed by a plain ArrayBuffer: `applicationServerKey` rejects a
     SharedArrayBuffer-backed view under the DOM types. */
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(workerUrl, { scope: BASE_URL.replace(/\/$/, '') || '/' });
  return navigator.serviceWorker.ready;
}

/** Ask the browser to let us notify; returns false if the user said no. */
async function askPermission(): Promise<boolean> {
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const answer = await Notification.requestPermission();
  return answer === 'granted';
}

/** Why the button cannot do anything, in words the page can show. */
export async function checkPush(): Promise<PushState> {
  if (STATIC_PREVIEW) {
    return { status: 'unconfigured', message: 'This is a preview build, so alerts are switched off.' };
  }
  if (!pushSupported()) {
    return { status: 'unsupported', message: 'This browser cannot receive order alerts. We will email you instead.' };
  }
  const config = await getConfig();
  if (!config?.enabled || !config.vapidPublicKey) {
    return { status: 'unconfigured', message: 'Order alerts are not switched on for this site yet. We will email you instead.' };
  }
  if (Notification.permission === 'denied') {
    return {
      status: 'blocked',
      message: 'Notifications are blocked for this site in your browser settings. Allow them, or we will email you instead.',
    };
  }
  if (isIosWithoutInstall()) {
    return {
      status: 'blocked',
      message: 'On an iPhone, add this site to your Home Screen first (Share → Add to Home Screen), then turn alerts on.',
    };
  }
  /* Deliberately not "when your order is ready": no status workflow advances an
     order in this build, so that promise could not be kept. What can be promised is
     a confirmation now and an alert if the order is cancelled. */
  return { status: 'idle', message: 'Turn alerts on for this order on this device — you will get one here if the kitchen cancels it.' };
}

/**
 * Subscribe this device to one order.
 *
 * The order code and tracking token prove this browser may watch that order; the
 * server refuses anything else, so a subscription can never be pointed at someone
 * else's order.
 */
export async function subscribeToOrder(code: string, token: string): Promise<PushState> {
  const state = await checkPush();
  if (state.status !== 'idle' && state.status !== 'subscribed') return state;

  const config = await getConfig();
  if (!config?.vapidPublicKey) return { status: 'unconfigured', message: 'Order alerts are not switched on yet.' };

  if (!(await askPermission())) {
    return { status: 'blocked', message: 'Without permission we cannot send an alert. We will email your receipt instead.' };
  }

  const registration = await registerWorker();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
  });

  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api/push/order-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token, subscription }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'blocked', message: (body as { error?: string }).error ?? 'We could not turn alerts on for this order.' };
    }
  } catch {
    return { status: 'blocked', message: 'We could not reach the kitchen to turn alerts on. Try again in a moment.' };
  }

  return { status: 'subscribed', message: 'Alerts are on for this device. You will get one here if the kitchen cancels this order.' };
}

/** Enrol this device as an owner device, using the key the host holds. */
export async function subscribeAsOwner(key: string): Promise<PushState> {
  if (!pushSupported()) {
    return { status: 'unsupported', message: 'This browser cannot receive alerts. Use Chrome, Edge, Firefox or Safari 16.4+.' };
  }
  const config = await getConfig();
  if (!config?.enabled || !config.vapidPublicKey) {
    return { status: 'unconfigured', message: 'Push is not switched on: HB_VAPID_PUBLIC_KEY / HB_VAPID_PRIVATE_KEY are missing.' };
  }
  if (!config.ownerEnrolment) {
    return { status: 'unconfigured', message: 'No owner key is set on this host, so owner devices cannot be enrolled.' };
  }
  if (isIosWithoutInstall()) {
    return { status: 'blocked', message: 'On an iPhone, add this site to your Home Screen first, then enrol this device.' };
  }
  if (!(await askPermission())) {
    return { status: 'blocked', message: 'Notifications are blocked for this site. Allow them in browser settings and try again.' };
  }

  const registration = await registerWorker();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
  });

  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api/push/owner-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hb-owner-key': key },
      body: JSON.stringify({ subscription }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'blocked', message: (body as { error?: string }).error ?? 'That did not work.' };
    }
  } catch {
    return { status: 'blocked', message: 'We could not reach the server. Check the connection and try again.' };
  }

  return { status: 'subscribed', message: 'This device is enrolled: every new order will alert it.' };
}

/** Stop alerts on this device entirely, server-side and locally. */
export async function unsubscribeThisDevice(): Promise<boolean> {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  const endpoint = subscription.endpoint;
  try {
    await fetch(`${BASE_URL.replace(/\/$/, '')}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    /* Local unsubscribe below still stops the noise on this device. */
  }
  return subscription.unsubscribe();
}

/** True when this browser already holds a subscription (not necessarily ours). */
export async function hasLocalSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}

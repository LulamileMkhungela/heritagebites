/*
 * Heritage Bites service worker — web push only.
 *
 * It deliberately does not cache anything. This site is a live menu with prices
 * and a payment flow; a stale cached shell showing yesterday's plate price is a
 * worse bug than a slow first paint. The worker exists for push, and nothing else.
 *
 * Served from the site root so its scope covers every route.
 */

self.addEventListener('install', () => {
  // Take over as soon as possible: a new version should alert, not wait for tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Heritage Bites', body: event.data ? event.data.text() : 'You have an update.' };
  }

  const title = payload.title || 'Heritage Bites';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'heritagebites',
    data: payload.data || {},
    requireInteraction: Boolean(payload.requireInteraction),
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    /*
     * Two notifications share a tag (one per order), so a busy kitchen replaces
     * the previous alert for the same order instead of stacking duplicates.
     */
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const code = event.notification.data?.code;
  const kind = event.notification.data?.kind;

  /*
   * Where a tap should land. A customer is sent back to the order page they
   * already hold the token for — the push payload has no token, on purpose, so
   * this uses whatever tab is already open. The owner gets the alerts page, which
   * shows whether the device is still enrolled.
   */
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (kind === 'owner-new-order' || !code) {
      for (const client of clientList) {
        if (client.url.includes('/alerts')) {
          await client.focus();
          return;
        }
      }
      const target = clientList.find((client) => client.focused) ?? clientList[0];
      if (target) {
        await target.focus();
        if (!target.url.includes('/alerts')) target.navigate('/alerts');
        return;
      }
      await self.clients.openWindow('/alerts');
      return;
    }

    /* A customer: reuse the tab that is already showing that order. */
    const onOrderPage = clientList.find((client) => client.url.includes(`/order/${code}`));
    if (onOrderPage) {
      await onOrderPage.focus();
      return;
    }
    if (clientList[0]) {
      await clientList[0].focus();
      return;
    }
    await self.clients.openWindow('/');
  })());
});

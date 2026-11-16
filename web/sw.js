/*
 * Heritage Bites service worker — web push only.
 *
 * It deliberately does not cache anything. This site is a live menu with prices
 * and a payment flow; a stale cached shell showing yesterday's plate price is a
 * worse bug than a slow first paint. The worker exists for push, and nothing else.
 *
 * Served from the site root so its scope covers every route.
 *
 * Because it caches nothing, it is also the one place that can *clear* what an
 * older version of this site left behind. The owner asked for the cache to be
 * cleared (16 Nov 2026) after a preview kept showing an old build: a customer
 * whose browser held a previous worker would otherwise keep being served from a
 * cache no current file refers to, and no amount of redeploying fixes it.
 */

/** A name change forces the browser to install this worker even if the file's
 *  bytes were never updated, which is how a stuck client gets unstuck. */
const CACHE_VERSION = 'hb-clear-2';

self.addEventListener('install', () => {
  // Take over as soon as possible: a new version should alert, not wait for tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      /*
       * Delete every cache this origin has — not just ours.
       *
       * The site has never intentionally stored one, so anything found here is
       * the residue of an older build or a browser that cached a prototype. The
       * risk of deleting is nil (nothing is read back from them); the risk of
       * leaving them is a customer seeing last week's prices.
       */
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        /* Private mode and hardened browsers may refuse; losing push over it
           would be worse than a stale cache, so this never throws. */
      }
      await self.clients.claim();
    })(),
  );
});

/*
 * `CACHE_VERSION` is read here so the constant is not tree-shaken away by a
 * minifier — it exists to change the worker's bytes, which is what makes the
 * browser notice an update at all.
 */
self.__hbCacheVersion = CACHE_VERSION;

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
    /* The real badge, so a kitchen alert on a phone looks like the shop. */
    icon: '/icon-192.png',
    /* Android wants a small monochrome mark here; the tile reads as one at 24px. */
    badge: '/favicon-32.png',
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

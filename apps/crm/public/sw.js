// Web Push only: this worker has no fetch handler and caches nothing.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Resolves a notification link against the CRM's own origin; a link to any other origin opens the home page. */
function sameOriginLink(raw) {
  try {
    const url = new URL(typeof raw === 'string' && raw ? raw : '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL('/', self.location.origin).href;
  } catch {
    return new URL('/', self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'ABM CRM', body: event.data.text() };
    }
  }
  const title = payload.title || 'ABM CRM';
  const body = payload.body || '';
  const link = payload.link || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      if (windowClients.some((client) => client.focused)) {
        return;
      }
      return self.registration.showNotification(title, {
        body,
        data: { link },
        icon: '/icon-192.png',
        tag: link,
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = sameOriginLink(event.notification.data && event.notification.data.link);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          try {
            await client.focus();
            // navigate() rejects for a window this worker does not control; open the link in a new window then.
            if (!('navigate' in client)) throw new Error('navigate unavailable');
            await client.navigate(link);
          } catch {
            if (self.clients.openWindow) await self.clients.openWindow(link);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(link);
      }
    }),
  );
});

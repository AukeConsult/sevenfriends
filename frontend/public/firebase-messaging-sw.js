// The ONE service worker of Seven Friends (a scope can only have one).
// Its jobs:
//  1. push: a message from the backend (Firebase Cloud Messaging) arrives while the app is closed, in the
//     background or the phone is locked -> show it as the system's notification
//  2. notificationclick: a click on any notification (pushed, or shown by the open page) brings the app to the
//     front and opens the right page
// It caches nothing. The page registers it from desktop-notice.service.ts.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  // the backend sends data only: { id, title, body, url } (FCM puts it under "data")
  const data = payload.data || payload;
  if (!data.title) return;

  event.waitUntil(
    (async () => {
      // somebody is looking at the app right now: the page shows it itself (sound, list), no notification. The page only knows its own circle, so it is
      // told about the push: when it is about ANOTHER circle, the page shows the notification (see desktop-notice.service.ts)
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const looking = windows.filter((client) => client.visibilityState === 'visible' && client.focused);
      if (looking.length) {
        looking.forEach((client) => client.postMessage({ type: 'push', data }));
        return;
      }

      await self.registration.showNotification(data.title, {
        body: data.body || '',
        tag: data.id, // the event's unique id: the same event is shown once (also when the open page shows it too)
        silent: data.silent === '1', // the person chose "No sound" for this kind of event
        data: { url: data.url || '/' },
        icon: '/icons/icon-192.png',
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'open', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

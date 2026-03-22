/**
 * Web Push service worker — replaces firebase-messaging-sw.js.
 *
 * Handles push events and notification clicks using the standard Web Push API.
 * No Firebase SDK dependencies.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "CS Batagi", body: event.data.text() || "Yeni bir bildirim var." };
  }

  const title = payload.title || "CS Batagi";
  const options = {
    body: payload.body || "Yeni bir bildirim var.",
    icon: payload.icon || "/images/BatakLogo192.png",
    tag: payload.data?.eventId || payload.data?.topic || undefined,
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawLink = event.notification?.data?.link || "/";
  const targetUrl = new URL(rawLink, self.location.origin).toString();
  const parsedUrl = new URL(targetUrl);
  const clientPath = parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          try {
            client.postMessage({
              type: "NOTIFICATION_CLICK",
              url: clientPath,
            });
            await client.focus();
            return;
          } catch (_error) {
            // Try next client or fallback to openWindow.
          }
        }
        await self.clients.openWindow(targetUrl);
      })
  );
});

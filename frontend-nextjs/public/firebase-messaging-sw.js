importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAJpmATHX2Zugnm4c1WhU5Kg9iMOruiZBU",
  authDomain: "csbatagirealtimedb.firebaseapp.com",
  projectId: "csbatagirealtimedb",
  messagingSenderId: "408840223663",
  appId: "1:408840223663:web:bdcf576d64b3a1fb6c4d5a",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.data?.title || payload?.notification?.title || "CS Batağı";
  const options = {
    body: payload?.data?.body || payload?.notification?.body || "Yeni bir bildirim var.",
    icon: payload?.data?.icon || "/images/BatakLogo192.png",
    tag: payload?.data?.eventId || payload?.data?.topic || undefined,
    data: payload?.data || {},
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawLink = event.notification?.data?.link || "/";
  const targetUrl = new URL(rawLink, self.location.origin).toString();
  // Keep just the pathname+search+hash for client-side navigation
  const parsedUrl = new URL(targetUrl);
  const clientPath = parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        // If an existing window is available, use postMessage for seamless
        // client-side navigation instead of client.navigate() which causes
        // a full page reload (white screen, Firebase reconnection delay).
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

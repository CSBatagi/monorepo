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

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          try {
            await client.navigate(targetUrl);
            await client.focus();
            return;
          } catch (_error) {
            // Try next client or fallback openWindow.
          }
        }
        await self.clients.openWindow(targetUrl);
      })
  );
});

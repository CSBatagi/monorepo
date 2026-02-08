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
  const title = payload?.notification?.title || "CS Batagi";
  const options = {
    body: payload?.notification?.body || "Yeni bir bildirim var.",
    icon: "/images/BatakLogo192.png",
    data: payload?.data || {},
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification?.data?.link || "/";
  event.waitUntil(self.clients.openWindow(link));
});

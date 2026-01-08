/**
 * Service Worker for CS Batağı PWA
 * Handles: Push notifications (Web Push/VAPID) + Offline caching
 * Note: FCM has been removed - this uses standard Web Push API for iOS PWA compatibility
 */

const CACHE_NAME = 'csbatagi-cache-v2';
const urlsToCache = [
  '/',
  '/manifest.json',
  '/images/BatakLogo192.png',
  '/images/BatakLogo.png'
];

// ============ Push Notification Handlers ============

self.addEventListener('push', function(event) {
  console.log('[SW] Push received:', event);
  
  let data = {
    title: 'CS Batağı',
    body: 'Yeni bildirim',
    icon: '/images/BatakLogo192.png',
    badge: '/images/BatakLogo192.png',
    url: '/',
    tag: 'default'
  };
  
  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      console.error('[SW] Error parsing push data:', e);
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    renotify: true,
    requireInteraction: false,
    data: {
      url: data.url,
      ...data.data
    },
    actions: [
      { action: 'open', title: 'Aç' },
      { action: 'dismiss', title: 'Kapat' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification click:', event.action);
  event.notification.close();
  
  if (event.action === 'dismiss') {
    return;
  }
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If there's already a window open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client && 'navigate' in client) {
          return client.focus().then(() => client.navigate(urlToOpen));
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('notificationclose', function(event) {
  console.log('[SW] Notification closed:', event.notification.tag);
});

// ============ Cache Handlers ============

self.addEventListener('install', function(event) {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[SW] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(function() {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
      .catch(function(err) {
        console.error('[SW] Cache addAll failed:', err);
      })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        })
      );
    }).then(function() {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Network-first strategy for API calls, cache-first for static assets
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Network-first for API and data
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/data/') || 
      url.pathname.includes('runtime-data')) {
    event.respondWith(
      fetch(event.request)
        .catch(function() {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(function(response) {
      if (response) {
        return response;
      }
      return fetch(event.request).then(function(response) {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        // Clone and cache
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    })
  );
});

// ============ Push Subscription Change Handler ============

self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[SW] Push subscription changed');
  // This can happen when the browser refreshes the subscription
  // The frontend should handle re-subscribing when needed
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true
    }).then(function(subscription) {
      console.log('[SW] Re-subscribed after change');
      // Notify any open clients to update their subscription on the server
      return self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({
            type: 'PUSH_SUBSCRIPTION_CHANGED',
            subscription: subscription.toJSON()
          });
        });
      });
    })
  );
});

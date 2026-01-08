'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Register the new service worker
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('[App] Service Worker registered:', registration.scope);
          
          // Check for updates periodically
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available
                  console.log('[App] New service worker available');
                }
              });
            }
          });
        })
        .catch((err) => {
          console.error('[App] Service Worker registration failed:', err);
        });

      // Listen for messages from the service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
          console.log('[App] Push subscription changed, may need to re-register');
          // Could trigger a re-subscription flow here if needed
        }
      });

      // Unregister any old FCM service workers
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          // Check if this is the old firebase-messaging-sw.js
          if (registration.active?.scriptURL?.includes('firebase-messaging-sw.js')) {
            registration.unregister().then(() => {
              console.log('[App] Unregistered old FCM service worker');
            });
          }
        }
      });
    }
  }, []);

  return null; // This component doesn't render anything
}

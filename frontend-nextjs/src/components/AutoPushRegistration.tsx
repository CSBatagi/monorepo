'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { useSession } from '@/contexts/SessionContext';
import { getDeviceRegistration, registerDevice } from '@/lib/liveApi';
import { getOrCreateDeviceId, isAutoPushOptedOut, setAutoPushOptOut } from '@/lib/pushRegistrationState';

const AUTO_PUSH_ATTEMPT_KEY = 'csbatagi_auto_push_attempt_v1';

function detectPlatform(): 'ios' | 'android' | 'web' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'web';
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function ensureDeviceRegistered(deviceId: string): Promise<void> {
  const configResp = await fetch('/api/notifications/public-config', { cache: 'no-store' });
  const config = await configResp.json().catch(() => null);
  const vapidKey = typeof config?.vapidKey === 'string' ? config.vapidKey : '';
  if (!vapidKey) return;

  const registration = await navigator.serviceWorker.register('/push-sw.js');
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  await registerDevice({
    deviceId,
    token: JSON.stringify(subscription),
    platform: detectPlatform(),
    userAgent: navigator.userAgent.slice(0, 200),
  });
}

export default function AutoPushRegistration() {
  const { user, ready } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready || !user) return;
    if (pathname === '/login' || pathname.startsWith('/notifications')) return;
    if (typeof window === 'undefined') return;
    if (typeof Notification === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const sessionAttemptKey = `${AUTO_PUSH_ATTEMPT_KEY}:${user.uid}`;
    if (window.sessionStorage.getItem(sessionAttemptKey) === '1') return;

    let cancelled = false;

    const run = async () => {
      try {
        const deviceId = getOrCreateDeviceId();
        if (isAutoPushOptedOut(user.uid, deviceId)) {
          window.sessionStorage.setItem(sessionAttemptKey, '1');
          return;
        }
        const deviceState = await getDeviceRegistration(deviceId).catch(() => null);
        if (cancelled) return;

        if (deviceState?.registered && deviceState.enabled === true) {
          window.sessionStorage.setItem(sessionAttemptKey, '1');
          return;
        }

        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        if (cancelled) return;

        if (permission !== 'granted') {
          setAutoPushOptOut(user.uid, deviceId, true);
          window.sessionStorage.setItem(sessionAttemptKey, '1');
          return;
        }

        await ensureDeviceRegistered(deviceId);
        if (cancelled) return;

        setAutoPushOptOut(user.uid, deviceId, false);
        window.sessionStorage.setItem(sessionAttemptKey, '1');
      } catch {
        // Best-effort only. The Notifications page remains the manual fallback.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [pathname, ready, user]);

  return null;
}

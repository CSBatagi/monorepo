"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Handles notification click events from the service worker.
 *
 * When a user taps a push notification while the app is open, the service worker
 * sends a postMessage with the target URL. This component listens for that message
 * and performs client-side navigation (avoiding a full page reload).
 *
 * With standard Web Push (replacing FCM), the service worker handles push display
 * directly — no foreground onMessage handler is needed.
 */
export default function NotificationForegroundHandler() {
  const router = useRouter();

  useEffect(() => {
    function handleServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === "NOTIFICATION_CLICK" && typeof event.data.url === "string") {
        router.push(event.data.url);
      }
    }

    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [router]);

  return null;
}

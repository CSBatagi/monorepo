"use client";

import { useEffect, useRef } from "react";
import { getMessaging, isSupported, onMessage } from "firebase/messaging";

import { useAuth } from "@/contexts/AuthContext";
import { app } from "@/lib/firebase";

export default function NotificationForegroundHandler() {
  const { user } = useAuth();
  const lastFingerprintRef = useRef<string>("");

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    async function setup() {
      if (!user) return;
      if (typeof window === "undefined" || typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;

      const supported = await isSupported().catch(() => false);
      if (!supported || cancelled) return;

      const messaging = getMessaging(app);
      unsubscribe = onMessage(messaging, async (payload) => {
        try {
          const data = payload.data || {};
          const title = payload.notification?.title || data.title || "CS Batagi";
          const body = payload.notification?.body || data.body || "Yeni bir bildirim var.";
          const icon = payload.notification?.icon || data.icon || "/images/BatakLogo192.png";
          const link = data.link || "/";
          const tag = data.eventId || data.topic || undefined;

          const fingerprint = `${title}|${body}|${String(tag || "")}`;
          if (lastFingerprintRef.current === fingerprint) return;
          lastFingerprintRef.current = fingerprint;
          setTimeout(() => {
            if (lastFingerprintRef.current === fingerprint) {
              lastFingerprintRef.current = "";
            }
          }, 4000);

          const registration = await navigator.serviceWorker
            .getRegistration("/firebase-messaging-sw.js")
            .catch(() => undefined);

          if (registration?.showNotification) {
            await registration.showNotification(title, {
              body,
              icon,
              tag,
              data: { ...data, link },
            });
            return;
          }

          new Notification(title, {
            body,
            icon,
            tag,
          });
        } catch (error) {
          console.warn("[notifications] Foreground notification display failed", error);
        }
      });
    }

    void setup();
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [user]);

  return null;
}

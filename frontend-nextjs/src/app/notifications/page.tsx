"use client";

import { useEffect, useMemo, useState } from "react";

import { useSession } from "@/contexts/SessionContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  getDeviceRegistration,
  registerDevice,
  unregisterDevice,
} from "@/lib/liveApi";
import { getOrCreateDeviceId, setAutoPushOptOut } from "@/lib/pushRegistrationState";

type TopicKey =
  | "teker_dondu_reached"
  | "mvp_poll_locked"
  | "stats_updated"
  | "timed_reminders"
  | "admin_custom_message";

type NotificationPreferences = {
  enabled: boolean;
  topics: Record<TopicKey, boolean>;
};

const TOPIC_META: Array<{ key: TopicKey; label: string; description: string }> = [
  {
    key: "teker_dondu_reached",
    label: "Teker döndü",
    description: "Katılım sayısı 10 oyuncuya ulaşınca bildir.",
  },
  {
    key: "mvp_poll_locked",
    label: "Gecenin MVP'si ödülü",
    description: "MVP oylaması bitince bildir.",
  },
  {
    key: "admin_custom_message",
    label: "Admin mesajları",
    description: "Admin tarafından gönderilen duyuruları bildir.",
  },
  {
    key: "stats_updated",
    label: "Yeni statlar basıldı",
    description: "Veritabanı güncellenince yeni istatistik bildirimi gönder.",
  },
  {
    key: "timed_reminders",
    label: "Zamanlı hatırlatmalar",
    description: "Pazartesi/Salı gibi planlı otomatik bildirimleri göster.",
  },
];

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  topics: {
    teker_dondu_reached: true,
    mvp_poll_locked: true,
    stats_updated: true,
    timed_reminders: true,
    admin_custom_message: true,
  },
};

function detectPlatform(): "ios" | "android" | "web" {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  if (ua.includes("android")) return "android";
  return "web";
}

export default function NotificationsPage() {
  const { user } = useSession();
  const { isDark } = useTheme();

  const [deviceId, setDeviceId] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<string>("default");
  const [isMessagingAvailable, setIsMessagingAvailable] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [deviceRegistered, setDeviceRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTitle, setAdminTitle] = useState("");
  const [adminBody, setAdminBody] = useState("");
  const [adminSending, setAdminSending] = useState(false);
  const [adminResult, setAdminResult] = useState("");

  const cardClass = useMemo(
    () =>
      isDark
        ? "bg-dark-surface border border-dark-border text-gray-100"
        : "bg-white border border-gray-200 text-gray-900",
    [isDark]
  );

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
    if (typeof Notification !== "undefined") {
      setNotificationPermission(Notification.permission);
    }

    setIsMessagingAvailable('PushManager' in window && 'serviceWorker' in navigator);
  }, []);

  // Load preferences + device registration from PG via HTTP
  useEffect(() => {
    if (!user || !deviceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const [prefsData, deviceData] = await Promise.all([
          getNotificationPreferences(),
          getDeviceRegistration(deviceId),
        ]);

        if (cancelled) return;

        setPrefs({
          enabled: prefsData.enabled ?? DEFAULT_PREFERENCES.enabled,
          topics: {
            ...DEFAULT_PREFERENCES.topics,
            ...(prefsData.topics || {}),
          },
        });
        setDeviceRegistered(deviceData.registered && deviceData.enabled === true);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load notification settings", err);
        setPrefs({ ...DEFAULT_PREFERENCES });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, deviceId]);

  // Admin check via PG backend
  useEffect(() => {
    if (!user) return;
    fetch("/api/admin/check", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setIsAdmin(!!data.isAdmin))
      .catch(() => setIsAdmin(false));
  }, [user]);

  async function handleSavePreferences(nextPrefs: NotificationPreferences) {
    if (!user) return;
    setSaving(true);
    setMessage("");
    try {
      await saveNotificationPreferences({ enabled: nextPrefs.enabled, topics: nextPrefs.topics });
      setPrefs(nextPrefs);
      setMessage("Bildirim tercihleri güncellendi.");
    } catch (error) {
      console.error("Failed to save notification preferences", error);
      setMessage("Tercihler kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function registerThisDevice() {
    if (!user) return;
    setSaving(true);
    setMessage("");

    try {
      if (!isMessagingAvailable) {
        setMessage("Bu cihaz/tarayici push desteklemiyor.");
        return;
      }

      if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
        setMessage("Tarayici service worker veya notification API desteklemiyor.");
        return;
      }

      const configResp = await fetch("/api/notifications/public-config", { cache: "no-store" });
      const configJson = await configResp.json();
      const vapidPublicKey = configJson?.vapidKey as string | null;
      if (!vapidPublicKey) {
        setMessage("VAPID key ayarlanmamis. VAPID_PUBLIC_KEY eksik.");
        return;
      }

      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setMessage("Bildirim izni verilmedi.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/push-sw.js");
      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready;

      // Convert base64url VAPID key to Uint8Array for Web Push API
      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from(raw, (char) => char.charCodeAt(0));
      };

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      // If there's an existing subscription with a different VAPID key (e.g. old Firebase key),
      // unsubscribe first so we can re-subscribe with the new key.
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        try {
          await existingSub.unsubscribe();
        } catch (e) {
          console.warn("Failed to unsubscribe old push subscription", e);
        }
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Store the full PushSubscription JSON as the "token"
      const subscriptionJson = JSON.stringify(subscription);

      const currentPrefs = prefs || { ...DEFAULT_PREFERENCES };
      await Promise.all([
        saveNotificationPreferences({
          ...currentPrefs,
          enabled: true,
        }),
        registerDevice({
          deviceId,
          token: subscriptionJson,
          platform: detectPlatform(),
          userAgent:
            typeof navigator !== "undefined"
              ? navigator.userAgent.slice(0, 200)
              : "unknown",
        }),
      ]);

      setAutoPushOptOut(user.uid, deviceId, false);
      setDeviceRegistered(true);
      setMessage("Bu cihaz bildirime acildi.");
    } catch (error: any) {
      console.error("Failed to register push notifications", error);
      setMessage(error?.message || "Bildirim kaydi basarisiz.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnectThisDevice() {
    if (!user) return;
    setSaving(true);
    setMessage("");
    try {
      await unregisterDevice(deviceId);
      setAutoPushOptOut(user.uid, deviceId, true);
      setDeviceRegistered(false);
      setMessage("Bu cihaz bildirim listesinden çıkarıldı.");
    } catch (error) {
      console.error("Failed to disconnect device", error);
      setMessage("Cihaz kaydı kaldırılamadı.");
    } finally {
      setSaving(false);
    }
  }

  async function sendAdminMessage() {
    if (!user || !isAdmin) return;
    if (!adminTitle.trim() || !adminBody.trim()) {
      setAdminResult("Başlık ve mesaj zorunlu.");
      return;
    }

    setAdminSending(true);
    setAdminResult("");
    try {
      const resp = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: adminTitle.trim(),
          body: adminBody.trim(),
        }),
      });
      const payload = await resp.json();
      if (!resp.ok) {
        setAdminResult(payload?.error || "Mesaj gönderilemedi.");
        return;
      }

      setAdminTitle("");
      setAdminBody("");
      setAdminResult(
        `Mesaj gönderildi. Başarılı: ${payload.successCount}, Hatalı: ${payload.failureCount}`
      );
    } catch (error: any) {
      setAdminResult(error?.message || "Mesaj gönderilemedi.");
    } finally {
      setAdminSending(false);
    }
  }

  const effectivePrefs = prefs || { ...DEFAULT_PREFERENCES };

  return (
    <div id="page-notifications" className="max-w-3xl mx-auto space-y-6">
      <div className={`rounded-xl p-5 shadow-sm ${cardClass}`}>
        <h2 className="text-2xl font-semibold mb-2">Bildirim Ayarları</h2>
        <p className={`${isDark ? "text-gray-400" : "text-gray-600"}`}>
          Mobilde uygulama gibi kullanmak için bu sayfadan bildirimleri açıp kapatabilirsiniz.
        </p>
      </div>

      <div className={`rounded-xl p-5 shadow-sm ${cardClass}`}>
        <h3 className="text-lg font-semibold mb-3">Cihaz Durumu</h3>
        <div className="space-y-2 text-sm">
          <p>Bildirim izni: <span className="font-semibold">{notificationPermission}</span></p>
          <p>Mesajlaşma desteği: <span className="font-semibold">{isMessagingAvailable ? "var" : "yok"}</span></p>
          <p>Bu cihaz kaydı: <span className="font-semibold">{deviceRegistered ? "aktif" : "pasif"}</span></p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={registerThisDevice}
            disabled={!user || saving}
            className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Bildirimleri Aç
          </button>
          <button
            onClick={disconnectThisDevice}
            disabled={!user || saving}
            className="px-4 py-2 rounded-md bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Bildirimleri Kapat
          </button>
        </div>
        {message && <p className="mt-3 text-sm">{message}</p>}
      </div>

      <div className={`rounded-xl p-5 shadow-sm ${cardClass}`}>
        <h3 className="text-lg font-semibold mb-3">Bildirim Tipleri</h3>
        {loading ? (
          <p className="text-sm">Yükleniyor...</p>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  const nextTopics = { ...effectivePrefs.topics };
                  for (const t of TOPIC_META) {
                    nextTopics[t.key] = true;
                  }
                  handleSavePreferences({
                    ...effectivePrefs,
                    enabled: true,
                    topics: nextTopics,
                  });
                }}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 font-medium transition-colors"
              >
                Hepsini aç
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextTopics = { ...effectivePrefs.topics };
                  for (const t of TOPIC_META) {
                    nextTopics[t.key] = false;
                  }
                  handleSavePreferences({
                    ...effectivePrefs,
                    enabled: true,
                    topics: nextTopics,
                  });
                }}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-medium transition-colors"
              >
                Hepsini kapat
              </button>
            </div>

            <hr className={`border-t ${isDark ? "border-dark-border" : "border-gray-200"}`} />

            {TOPIC_META.map((topic) => (
              <button
                key={topic.key}
                type="button"
                onClick={() =>
                  handleSavePreferences({
                    ...effectivePrefs,
                    enabled: true,
                    topics: {
                      ...effectivePrefs.topics,
                      [topic.key]: !effectivePrefs.topics[topic.key],
                    },
                  })
                }
                disabled={saving}
                className="w-full flex items-center justify-between gap-4 text-left hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                <div>
                  <div className="font-medium">{topic.label}</div>
                  <div className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                    {topic.description}
                  </div>
                </div>
                <div className={`flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center text-white font-bold text-xl ${
                  effectivePrefs.topics[topic.key] ? "bg-green-600" : "bg-red-600"
                }`}>
                  {effectivePrefs.topics[topic.key] ? "✓" : "✗"}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className={`rounded-xl p-5 shadow-sm ${cardClass}`}>
          <h3 className="text-lg font-semibold mb-3">Admin Mesaj Gönder</h3>
          <div className="space-y-3">
            <input
              type="text"
              value={adminTitle}
              onChange={(e) => setAdminTitle(e.target.value)}
              placeholder="Başlık"
              className={`w-full border rounded-md px-3 py-2 ${
                isDark ? "bg-dark-card border-dark-border text-gray-100" : "border-gray-300"
              }`}
            />
            <textarea
              value={adminBody}
              onChange={(e) => setAdminBody(e.target.value)}
              placeholder="Mesaj"
              rows={4}
              className={`w-full border rounded-md px-3 py-2 ${
                isDark ? "bg-dark-card border-dark-border text-gray-100" : "border-gray-300"
              }`}
            />
            <button
              onClick={sendAdminMessage}
              disabled={adminSending}
              className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {adminSending ? "Gönderiliyor..." : "Mesajı Gönder"}
            </button>
            {adminResult && <p className="text-sm">{adminResult}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

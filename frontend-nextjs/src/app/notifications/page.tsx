"use client";

import { useEffect, useMemo, useState } from "react";
import { get, onValue, ref, remove, set } from "firebase/database";
import { getMessaging, getToken, isSupported } from "firebase/messaging";

import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { app, db } from "@/lib/firebase";

type TopicKey =
  | "teker_dondu_reached"
  | "mvp_poll_locked"
  | "stats_updated"
  | "timed_reminders"
  | "admin_custom_message";

type NotificationPreferences = {
  enabled: boolean;
  topics: Record<TopicKey, boolean>;
  updatedAt: number;
};

const TOPIC_META: Array<{ key: TopicKey; label: string; description: string }> = [
  {
    key: "teker_dondu_reached",
    label: "Teker dondu",
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
  updatedAt: Date.now(),
};

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const key = "csbatagi_device_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  window.localStorage.setItem(key, randomId);
  return randomId;
}

function detectPlatform(): "ios" | "android" | "web" {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  if (ua.includes("android")) return "android";
  return "web";
}

export default function NotificationsPage() {
  const { user } = useAuth();
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

    isSupported()
      .then((supported) => setIsMessagingAvailable(supported))
      .catch(() => setIsMessagingAvailable(false));
  }, []);

  useEffect(() => {
    if (!user || !deviceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const prefRef = ref(db, `notifications/preferences/${user.uid}`);
    const deviceRef = ref(db, `notifications/subscriptions/${user.uid}/${deviceId}`);

    const unsubscribePrefs = onValue(prefRef, (snap) => {
      if (snap.exists()) {
        const raw = snap.val() as Partial<NotificationPreferences>;
        setPrefs({
          enabled: raw.enabled ?? DEFAULT_PREFERENCES.enabled,
          updatedAt: raw.updatedAt ?? Date.now(),
          topics: {
            ...DEFAULT_PREFERENCES.topics,
            ...(raw.topics || {}),
          },
        });
      } else {
        setPrefs({ ...DEFAULT_PREFERENCES, updatedAt: Date.now() });
      }
      setLoading(false);
    });

    const unsubscribeDevice = onValue(deviceRef, (snap) => {
      setDeviceRegistered(snap.exists() && snap.val()?.enabled === true);
    });

    return () => {
      unsubscribePrefs();
      unsubscribeDevice();
    };
  }, [user, deviceId]);

  useEffect(() => {
    if (!user) return;
    get(ref(db, `admins/${user.uid}`))
      .then((snap) => {
        setIsAdmin(snap.exists() && snap.val() === true);
      })
      .catch(() => setIsAdmin(false));
  }, [user]);

  async function savePreferences(nextPrefs: NotificationPreferences) {
    if (!user) return;
    setSaving(true);
    setMessage("");
    try {
      const payload = { ...nextPrefs, updatedAt: Date.now() };
      await set(ref(db, `notifications/preferences/${user.uid}`), payload);
      setPrefs(payload);
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
        setMessage("Bu cihaz/tarayıcı Firebase push desteklemiyor.");
        return;
      }

      if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
        setMessage("Tarayıcı service worker veya notification API desteklemiyor.");
        return;
      }

      const configResp = await fetch("/api/notifications/public-config", { cache: "no-store" });
      const configJson = await configResp.json();
      const vapidKey = configJson?.vapidKey as string | null;
      if (!vapidKey) {
        setMessage("VAPID key ayarlanmamış. FIREBASE_VAPID_KEY eksik.");
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

      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        setMessage("FCM token alınamadı.");
        return;
      }

      const currentPrefs = prefs || { ...DEFAULT_PREFERENCES, updatedAt: Date.now() };
      await Promise.all([
        set(ref(db, `notifications/preferences/${user.uid}`), {
          ...currentPrefs,
          enabled: true,
          updatedAt: Date.now(),
        }),
        set(ref(db, `notifications/subscriptions/${user.uid}/${deviceId}`), {
          token,
          enabled: true,
          platform: detectPlatform(),
          userAgent:
            typeof navigator !== "undefined"
              ? navigator.userAgent.slice(0, 200)
              : "unknown",
          updatedAt: Date.now(),
        }),
      ]);

      setDeviceRegistered(true);
      setMessage("Bu cihaz bildirime açıldı.");
    } catch (error: any) {
      console.error("Failed to register push notifications", error);
      setMessage(error?.message || "Bildirim kaydı başarısız.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnectThisDevice() {
    if (!user) return;
    setSaving(true);
    setMessage("");
    try {
      await remove(ref(db, `notifications/subscriptions/${user.uid}/${deviceId}`));
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
      const idToken = await user.getIdToken();
      const resp = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
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

  const effectivePrefs = prefs || { ...DEFAULT_PREFERENCES, updatedAt: Date.now() };

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
            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Tüm bildirimler</div>
                <div className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                  Tek tuşla tüm bildirim türlerini aç/kapat.
                </div>
              </div>
              <input
                type="checkbox"
                checked={effectivePrefs.enabled}
                onChange={(e) =>
                  savePreferences({
                    ...effectivePrefs,
                    enabled: e.target.checked,
                  })
                }
                disabled={saving}
              />
            </label>

            {TOPIC_META.map((topic) => (
              <label key={topic.key} className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{topic.label}</div>
                  <div className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                    {topic.description}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(effectivePrefs.topics[topic.key])}
                  onChange={(e) =>
                    savePreferences({
                      ...effectivePrefs,
                      topics: {
                        ...effectivePrefs.topics,
                        [topic.key]: e.target.checked,
                      },
                    })
                  }
                  disabled={saving}
                />
              </label>
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

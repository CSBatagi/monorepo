"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/contexts/SessionContext";

export type InboxNotification = {
  id: string;
  topic: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  createdAt: number;
  eventId?: string;
};

interface NotificationContextType {
  notifications: InboxNotification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  deleteNotification: async () => {},
  clearAll: async () => {},
});

const MAX_INBOX_ITEMS = 100;
const POLL_INTERVAL_MS = 15_000;

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const uid = user?.uid ?? null;

  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);

  const fetchInbox = useCallback(async (force = false) => {
    if (!uid) return;

    const version = force ? 0 : versionRef.current;
    const response = await fetch(`/api/notifications/inbox?v=${version}&limit=${MAX_INBOX_ITEMS}`, {
      cache: "no-store",
    });

    if (response.status === 304) {
      setLoading(false);
      return;
    }

    if (response.status === 401) {
      versionRef.current = 0;
      setNotifications([]);
      setLoading(false);
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    versionRef.current = Number(payload?.version || 0);
    setNotifications(Array.isArray(payload?.notifications) ? payload.notifications : []);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      versionRef.current = 0;
      setNotifications([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    setLoading(true);
    const runFetch = async (force = false) => {
      try {
        await fetchInbox(force);
      } catch (error) {
        if (!cancelled) {
          console.error("[NotificationContext] inbox fetch failed:", error);
          setLoading(false);
        }
      }
    };

    void runFetch(true);
    intervalId = setInterval(() => {
      void runFetch(false);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [uid, fetchInbox]);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );

    const response = await fetch(`/api/notifications/inbox/${id}`, {
      method: "PATCH",
    });
    if (!response.ok) {
      await fetchInbox(true);
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.version) {
      versionRef.current = Number(payload.version || versionRef.current);
    }
  }, [fetchInbox]);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));

    const response = await fetch("/api/notifications/inbox/mark-all", {
      method: "POST",
    });
    if (!response.ok) {
      await fetchInbox(true);
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.version) {
      versionRef.current = Number(payload.version || versionRef.current);
    }
  }, [fetchInbox]);

  const deleteNotification = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));

    const response = await fetch(`/api/notifications/inbox/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await fetchInbox(true);
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.version) {
      versionRef.current = Number(payload.version || versionRef.current);
    }
  }, [fetchInbox]);

  const clearAll = useCallback(async () => {
    setNotifications([]);

    const response = await fetch("/api/notifications/inbox/clear", {
      method: "POST",
    });
    if (!response.ok) {
      await fetchInbox(true);
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    if (payload?.version !== undefined) {
      versionRef.current = Number(payload.version || 0);
    }
  }, [fetchInbox]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications]
  );

  const value = useMemo<NotificationContextType>(() => ({
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  }), [notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification, clearAll]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

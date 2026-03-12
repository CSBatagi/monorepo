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

/* ─── types ─── */

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
  /** All inbox notifications, newest first */
  notifications: InboxNotification[];
  /** Count of unread notifications */
  unreadCount: number;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Mark a single notification as read */
  markAsRead: (id: string) => Promise<void>;
  /** Mark all notifications as read */
  markAllAsRead: () => Promise<void>;
  /** Delete a single notification */
  deleteNotification: (id: string) => Promise<void>;
  /** Clear (delete) all notifications */
  clearAll: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  loading: false, // false by default so NotificationBell works outside NotificationProvider
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  deleteNotification: async () => {},
  clearAll: async () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

/* ─── constants ─── */

const MAX_INBOX_ITEMS = 100;

/* ─── provider ─── */

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const uid = user?.uid ?? null;
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);
  // Keep a ref to firebase DB helpers so callbacks can use them without re-importing
  const firebaseRef = useRef<{
    db: import("firebase/database").Database;
    ref: typeof import("firebase/database").ref;
    update: typeof import("firebase/database").update;
    remove: typeof import("firebase/database").remove;
  } | null>(null);

  // Real-time subscription to user's inbox (lazy-loads Firebase SDK)
  useEffect(() => {
    if (!uid) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const [{ db }, { ref, onValue, query, orderByChild, limitToLast, update, remove }] = await Promise.all([
        import("@/lib/firebase"),
        import("firebase/database"),
      ]);
      firebaseRef.current = { db, ref, update, remove };

      if (cancelled) return;

      setLoading(true);
      const inboxRef = ref(db, `notifications/inbox/${uid}`);
      const inboxQuery = query(
        inboxRef,
        orderByChild("createdAt"),
        limitToLast(MAX_INBOX_ITEMS)
      );

      unsubscribe = onValue(
        inboxQuery,
        (snap) => {
          if (!snap.exists()) {
            setNotifications([]);
            setLoading(false);
            return;
          }

          const items: InboxNotification[] = [];
          snap.forEach((child) => {
            const val = child.val();
            items.push({
              id: child.key!,
              topic: val.topic || "",
              title: val.title || "",
              body: val.body || "",
              data: val.data || undefined,
              read: val.read === true,
              createdAt: val.createdAt || 0,
              eventId: val.eventId || undefined,
            });
          });

          // Sort newest first
          items.sort((a, b) => b.createdAt - a.createdAt);
          setNotifications(items);
          setLoading(false);
        },
        (error) => {
          console.error("[NotificationContext] inbox subscription error:", error);
          setLoading(false);
        }
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [uid]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const markAsRead = useCallback(
    async (id: string) => {
      const fb = firebaseRef.current;
      if (!uid || !fb) return;
      await fb.update(fb.ref(fb.db, `notifications/inbox/${uid}/${id}`), {
        read: true,
      });
    },
    [uid]
  );

  const markAllAsRead = useCallback(async () => {
    const fb = firebaseRef.current;
    if (!uid || !fb || notifications.length === 0) return;
    const updates: Record<string, boolean> = {};
    for (const n of notifications) {
      if (!n.read) {
        updates[`${n.id}/read`] = true;
      }
    }
    if (Object.keys(updates).length === 0) return;
    await fb.update(fb.ref(fb.db, `notifications/inbox/${uid}`), updates);
  }, [uid, notifications]);

  const deleteNotification = useCallback(
    async (id: string) => {
      const fb = firebaseRef.current;
      if (!uid || !fb) return;
      await fb.remove(fb.ref(fb.db, `notifications/inbox/${uid}/${id}`));
    },
    [uid]
  );

  const clearAll = useCallback(async () => {
    const fb = firebaseRef.current;
    if (!uid || !fb) return;
    await fb.remove(fb.ref(fb.db, `notifications/inbox/${uid}`));
  }, [uid]);

  const value = useMemo<NotificationContextType>(
    () => ({
      notifications,
      unreadCount,
      loading,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      clearAll,
    }),
    [notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification, clearAll]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

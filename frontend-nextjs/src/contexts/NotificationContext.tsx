"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  update,
} from "firebase/database";

import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";

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
  loading: true,
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
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time subscription to user's inbox
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const inboxRef = ref(db, `notifications/inbox/${user.uid}`);
    const inboxQuery = query(
      inboxRef,
      orderByChild("createdAt"),
      limitToLast(MAX_INBOX_ITEMS)
    );

    const unsubscribe = onValue(
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

    return () => unsubscribe();
  }, [user]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const markAsRead = useCallback(
    async (id: string) => {
      if (!user) return;
      await update(ref(db, `notifications/inbox/${user.uid}/${id}`), {
        read: true,
      });
    },
    [user]
  );

  const markAllAsRead = useCallback(async () => {
    if (!user || notifications.length === 0) return;
    const updates: Record<string, boolean> = {};
    for (const n of notifications) {
      if (!n.read) {
        updates[`${n.id}/read`] = true;
      }
    }
    if (Object.keys(updates).length === 0) return;
    await update(ref(db, `notifications/inbox/${user.uid}`), updates);
  }, [user, notifications]);

  const deleteNotification = useCallback(
    async (id: string) => {
      if (!user) return;
      await remove(ref(db, `notifications/inbox/${user.uid}/${id}`));
    },
    [user]
  );

  const clearAll = useCallback(async () => {
    if (!user) return;
    await remove(ref(db, `notifications/inbox/${user.uid}`));
  }, [user]);

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

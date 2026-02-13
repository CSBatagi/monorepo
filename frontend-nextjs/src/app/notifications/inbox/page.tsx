"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Gamepad2, Trophy, BarChart3, Clock, Megaphone, Bell, type LucideIcon } from "lucide-react";

import { useTheme } from "@/contexts/ThemeContext";
import {
  InboxNotification,
  useNotifications,
} from "@/contexts/NotificationContext";

/* ─── topic display helpers ─── */

const TOPIC_LABELS: Record<string, string> = {
  teker_dondu_reached: "Teker döndü",
  mvp_poll_locked: "MVP Ödülü",
  stats_updated: "Stat güncellendi",
  timed_reminders: "Hatırlatma",
  admin_custom_message: "Admin mesajı",
};

const TOPIC_ICON_MAP: Record<string, LucideIcon> = {
  teker_dondu_reached: Gamepad2,
  mvp_poll_locked: Trophy,
  stats_updated: BarChart3,
  timed_reminders: Clock,
  admin_custom_message: Megaphone,
};

function TopicIcon({ topic, className }: { topic: string; className?: string }) {
  const Icon = TOPIC_ICON_MAP[topic] || Bell;
  return <Icon className={className || "w-4 h-4"} />;
}

const TOPIC_COLORS: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  teker_dondu_reached: { bg: "bg-green-100", text: "text-green-700", darkBg: "bg-green-900/30", darkText: "text-green-400" },
  mvp_poll_locked: { bg: "bg-yellow-100", text: "text-yellow-700", darkBg: "bg-yellow-900/30", darkText: "text-yellow-400" },
  stats_updated: { bg: "bg-purple-100", text: "text-purple-700", darkBg: "bg-purple-900/30", darkText: "text-purple-400" },
  timed_reminders: { bg: "bg-orange-100", text: "text-orange-700", darkBg: "bg-orange-900/30", darkText: "text-orange-400" },
  admin_custom_message: { bg: "bg-red-100", text: "text-red-700", darkBg: "bg-red-900/30", darkText: "text-red-400" },
};

type FilterType = "all" | "unread" | string;

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) return `Bugün ${time}`;
  if (isYesterday) return `Dün ${time}`;

  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }) + ` ${time}`;
}

/* ─── notification card ─── */

function InboxCard({
  notification,
  onMarkRead,
  onDelete,
  isDark,
}: {
  notification: InboxNotification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  isDark: boolean;
}) {
  const topicColor = TOPIC_COLORS[notification.topic] || TOPIC_COLORS.admin_custom_message;

  return (
    <div
      className={`group rounded-xl border p-4 transition-all duration-200 ${
        notification.read
          ? isDark
            ? "border-dark-border bg-dark-surface/50 hover:bg-dark-card/50"
            : "border-gray-200 bg-white hover:bg-gray-50"
          : isDark
            ? "border-blue-800/40 bg-blue-950/20 hover:bg-blue-950/30 shadow-sm shadow-blue-500/5"
            : "border-blue-200 bg-blue-50/50 hover:bg-blue-50 shadow-sm shadow-blue-100"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Unread indicator */}
        <div className="flex-shrink-0 mt-1">
          {!notification.read ? (
            <span className="block w-3 h-3 rounded-full bg-blue-500 shadow-sm shadow-blue-500/30" />
          ) : (
            <span className="block w-3 h-3" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                isDark
                  ? `${topicColor.darkBg} ${topicColor.darkText}`
                  : `${topicColor.bg} ${topicColor.text}`
              }`}
            >
              <span aria-hidden="true"><TopicIcon topic={notification.topic} className="w-4 h-4" /></span>
              {TOPIC_LABELS[notification.topic] || notification.topic}
            </span>
            <span
              className={`text-xs ${
                isDark ? "text-gray-500" : "text-gray-400"
              }`}
            >
              {formatDate(notification.createdAt)}
            </span>
          </div>

          <h4
            className={`text-sm font-semibold mb-0.5 ${
              isDark ? "text-gray-100" : "text-gray-900"
            }`}
          >
            {notification.title}
          </h4>
          <p
            className={`text-sm leading-relaxed ${
              isDark ? "text-gray-400" : "text-gray-600"
            }`}
          >
            {notification.body}
          </p>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!notification.read && (
            <button
              onClick={() => onMarkRead(notification.id)}
              title="Okundu"
              className={`p-2 rounded-lg transition-colors ${
                isDark
                  ? "hover:bg-dark-hover text-gray-400 hover:text-blue-400"
                  : "hover:bg-gray-200 text-gray-500 hover:text-blue-600"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onDelete(notification.id)}
            title="Sil"
            className={`p-2 rounded-lg transition-colors ${
              isDark
                ? "hover:bg-dark-hover text-gray-400 hover:text-red-400"
                : "hover:bg-gray-200 text-gray-500 hover:text-red-500"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── main page ─── */

export default function NotificationInboxPage() {
  const { isDark } = useTheme();
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  } = useNotifications();

  const [filter, setFilter] = useState<FilterType>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  // Available topic filters
  const topicsPresent = useMemo(() => {
    const set = new Set(notifications.map((n) => n.topic));
    return [...set].sort();
  }, [notifications]);

  // Filtered notifications
  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    if (filter === "unread") return notifications.filter((n) => !n.read);
    return notifications.filter((n) => n.topic === filter);
  }, [notifications, filter]);

  // Group by day
  const grouped = useMemo(() => {
    const groups: { label: string; items: InboxNotification[] }[] = [];
    let currentLabel = "";

    for (const n of filtered) {
      const date = new Date(n.createdAt);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = date.toDateString() === yesterday.toDateString();

      let label: string;
      if (isToday) label = "Bugün";
      else if (isYesterday) label = "Dün";
      else
        label = date.toLocaleDateString("tr-TR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });

      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, items: [] });
      }
      groups[groups.length - 1].items.push(n);
    }

    return groups;
  }, [filtered]);

  const handleMarkRead = useCallback(
    (id: string) => void markAsRead(id),
    [markAsRead]
  );

  const handleDelete = useCallback(
    (id: string) => void deleteNotification(id),
    [deleteNotification]
  );

  const handleClearAll = useCallback(() => {
    void clearAll();
    setConfirmClear(false);
  }, [clearAll]);

  const cardClass = isDark
    ? "bg-dark-surface border border-dark-border text-gray-100"
    : "bg-white border border-gray-200 text-gray-900";

  return (
    <div id="page-notification-inbox" className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className={`rounded-xl p-5 shadow-sm ${cardClass}`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-semibold">Bildirim Kutusu</h2>
          <Link
            href="/notifications"
            className={`text-sm font-medium transition-colors ${
              isDark
                ? "text-blue-400 hover:text-blue-300"
                : "text-blue-600 hover:text-blue-700"
            }`}
          >
            ⚙ Ayarlar
          </Link>
        </div>
        <p className={isDark ? "text-gray-400" : "text-gray-600"}>
          Tüm bildirimlerinizi buradan görebilir, okundu olarak işaretleyebilir veya silebilirsiniz.
        </p>
      </div>

      {/* Toolbar */}
      <div className={`rounded-xl p-4 shadow-sm ${cardClass}`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterButton
              active={filter === "all"}
              onClick={() => setFilter("all")}
              isDark={isDark}
            >
              Tümü ({notifications.length})
            </FilterButton>
            <FilterButton
              active={filter === "unread"}
              onClick={() => setFilter("unread")}
              isDark={isDark}
            >
              Okunmamış ({unreadCount})
            </FilterButton>
            {topicsPresent.map((topic) => (
              <FilterButton
                key={topic}
                active={filter === topic}
                onClick={() => setFilter(topic)}
                isDark={isDark}
              >
                <TopicIcon topic={topic} className="w-3.5 h-3.5 inline-block align-text-bottom" />{" "}
                {TOPIC_LABELS[topic] || topic}
              </FilterButton>
            ))}
          </div>

          {/* Bulk actions */}
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllAsRead()}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isDark
                    ? "bg-blue-900/30 text-blue-400 hover:bg-blue-900/50"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                }`}
              >
                Tümünü okundu yap
              </button>
            )}
            {notifications.length > 0 && (
              <>
                {!confirmClear ? (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isDark
                        ? "bg-red-900/30 text-red-400 hover:bg-red-900/50"
                        : "bg-red-50 text-red-600 hover:bg-red-100"
                    }`}
                  >
                    Tümünü sil
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleClearAll}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      Eminim, sil
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isDark
                          ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                          : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                      }`}
                    >
                      İptal
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Notification list */}
      {loading ? (
        <div className={`rounded-xl p-12 shadow-sm ${cardClass} flex items-center justify-center`}>
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-blue-500 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={`rounded-xl p-12 shadow-sm ${cardClass} flex flex-col items-center justify-center`}>
          <svg
            className={`h-16 w-16 mb-4 ${isDark ? "text-gray-600" : "text-gray-300"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={0.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p className={`text-base font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            {filter === "unread"
              ? "Tüm bildirimleriniz okunmuş"
              : "Henüz bildirim yok"}
          </p>
          <p className={`text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}>
            {filter === "unread"
              ? "Harika! Hiç okunmamış bildiriminiz kalmadı."
              : "Yeni bildirimler geldikçe burada görünecek."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3
                className={`text-xs font-semibold uppercase tracking-wider mb-3 px-1 ${
                  isDark ? "text-gray-500" : "text-gray-400"
                }`}
              >
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.items.map((n) => (
                  <InboxCard
                    key={n.id}
                    notification={n}
                    onMarkRead={handleMarkRead}
                    onDelete={handleDelete}
                    isDark={isDark}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── filter button ─── */

function FilterButton({
  active,
  onClick,
  isDark,
  children,
}: {
  active: boolean;
  onClick: () => void;
  isDark: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active
          ? isDark
            ? "bg-blue-600/30 text-blue-400 border border-blue-500/40"
            : "bg-blue-100 text-blue-700 border border-blue-200"
          : isDark
            ? "bg-dark-card text-gray-400 hover:text-gray-300 border border-dark-border hover:border-gray-600"
            : "bg-gray-100 text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

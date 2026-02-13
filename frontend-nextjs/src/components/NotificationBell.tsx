"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Gamepad2, Trophy, BarChart3, Clock, Megaphone, Bell, type LucideIcon } from "lucide-react";

import { useTheme } from "@/contexts/ThemeContext";
import {
  InboxNotification,
  useNotifications,
} from "@/contexts/NotificationContext";

/* ─── topic display helpers ─── */

const TOPIC_ICONS: Record<string, LucideIcon> = {
  teker_dondu_reached: Gamepad2,
  mvp_poll_locked: Trophy,
  stats_updated: BarChart3,
  timed_reminders: Clock,
  admin_custom_message: Megaphone,
};

function TopicIcon({ topic, className }: { topic: string; className?: string }) {
  const Icon = TOPIC_ICONS[topic] || Bell;
  return <Icon className={className || "w-4 h-4"} />;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "şimdi";
  if (minutes < 60) return `${minutes}dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}g`;
  const weeks = Math.floor(days / 7);
  return `${weeks}h`;
}

/* ─── dropdown item ─── */

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: InboxNotification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { isDark } = useTheme();

  return (
    <div
      className={`group relative px-4 py-3 border-b transition-colors ${
        notification.read
          ? isDark
            ? "border-dark-border bg-dark-surface/50"
            : "border-gray-100 bg-gray-50/50"
          : isDark
            ? "border-dark-border bg-blue-950/20"
            : "border-gray-100 bg-blue-50/40"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Unread dot */}
        <div className="flex-shrink-0 mt-1.5">
          {!notification.read ? (
            <span className="block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          ) : (
            <span className="block w-2.5 h-2.5 rounded-full bg-transparent" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-base flex-shrink-0" aria-hidden="true">
              <TopicIcon topic={notification.topic} className="w-4 h-4" />
            </span>
            <span
              className={`text-sm font-semibold truncate ${
                isDark ? "text-gray-100" : "text-gray-900"
              }`}
            >
              {notification.title}
            </span>
            <span
              className={`flex-shrink-0 text-xs ${
                isDark ? "text-gray-500" : "text-gray-400"
              }`}
            >
              {timeAgo(notification.createdAt)}
            </span>
          </div>
          <p
            className={`text-sm leading-snug line-clamp-2 ${
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
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(notification.id);
              }}
              title="Okundu olarak işaretle"
              className={`p-1.5 rounded-md transition-colors ${
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
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification.id);
            }}
            title="Sil"
            className={`p-1.5 rounded-md transition-colors ${
              isDark
                ? "hover:bg-dark-hover text-gray-400 hover:text-red-400"
                : "hover:bg-gray-200 text-gray-500 hover:text-red-500"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── main bell component ─── */

export default function NotificationBell() {
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

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  // Close on scroll (mobile UX — fixed panel shouldn't float while scrolling)
  useEffect(() => {
    if (!isOpen) return;
    let scrollY = window.scrollY;
    function handleScroll() {
      if (Math.abs(window.scrollY - scrollY) > 10) {
        setIsOpen(false);
      }
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleMarkRead = useCallback(
    (id: string) => {
      void markAsRead(id);
    },
    [markAsRead]
  );

  const handleDelete = useCallback(
    (id: string) => {
      void deleteNotification(id);
    },
    [deleteNotification]
  );

  const handleMarkAllRead = useCallback(() => {
    void markAllAsRead();
  }, [markAllAsRead]);

  const handleClearAll = useCallback(() => {
    void clearAll();
    setIsOpen(false);
  }, [clearAll]);

  const recentNotifications = notifications.slice(0, 8);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-label={`Bildirimler${unreadCount > 0 ? ` (${unreadCount} okunmamış)` : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors ${
          isDark
            ? "bg-gray-700 hover:bg-gray-600 text-gray-100 border border-gray-600/50"
            : "bg-gray-200 hover:bg-gray-300 text-gray-800"
        }`}
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label="Bildirimler"
            className={`
              fixed inset-x-3 top-16 z-50 rounded-xl shadow-2xl border overflow-hidden
              md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-[360px]
              ${isDark
                ? "bg-dark-surface border-dark-border"
                : "bg-white border-gray-200"
              }
            `}
            style={{ maxHeight: "min(520px, 70vh)" }}
          >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-4 py-3 border-b ${
              isDark ? "border-dark-border" : "border-gray-200"
            }`}
          >
            <h3
              className={`text-base font-semibold ${
                isDark ? "text-gray-100" : "text-gray-900"
              }`}
            >
              Bildirimler
              {unreadCount > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
                  {unreadCount} yeni
                </span>
              )}
            </h3>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  title="Tümünü okundu yap"
                  className={`p-1.5 rounded-md text-xs transition-colors ${
                    isDark
                      ? "hover:bg-dark-hover text-gray-400 hover:text-blue-400"
                      : "hover:bg-gray-100 text-gray-500 hover:text-blue-600"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={handleClearAll}
                  title="Tümünü sil"
                  className={`p-1.5 rounded-md text-xs transition-colors ${
                    isDark
                      ? "hover:bg-dark-hover text-gray-400 hover:text-red-400"
                      : "hover:bg-gray-100 text-gray-500 hover:text-red-500"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto" style={{ maxHeight: "min(400px, 55vh)" }}>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <svg
                  className={`h-12 w-12 mb-3 ${isDark ? "text-gray-600" : "text-gray-300"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p
                  className={`text-sm ${
                    isDark ? "text-gray-500" : "text-gray-400"
                  }`}
                >
                  Henüz bildirim yok
                </p>
              </div>
            ) : (
              recentNotifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={handleMarkRead}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>

          {/* Footer — always visible for navigation */}
          <div
            className={`border-t px-4 py-2.5 ${
              isDark ? "border-dark-border" : "border-gray-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <Link
                href="/notifications/inbox"
                onClick={() => setIsOpen(false)}
                className={`text-sm font-medium transition-colors ${
                  isDark
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-blue-600 hover:text-blue-700"
                }`}
              >
                Bildirim Kutusu →
              </Link>
              <Link
                href="/notifications"
                onClick={() => setIsOpen(false)}
                className={`text-xs transition-colors ${
                  isDark
                    ? "text-gray-500 hover:text-gray-400"
                    : "text-gray-400 hover:text-gray-500"
                }`}
              >
                ⚙ Ayarlar
              </Link>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

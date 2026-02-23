import "server-only";

import type { NotificationData } from "@/lib/serverNotifications";

export type TimedRuleContext = {
  now: Date;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat (Europe/Istanbul)
  hour: number;
  minute: number;
  dateKey: string; // YYYY-MM-DD in Europe/Istanbul
  comingCount: number;
};

export type TimedNotificationRule = {
  id: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
  title: string;
  body: (ctx: TimedRuleContext) => string;
  condition?: (ctx: TimedRuleContext) => boolean;
  data?: (ctx: TimedRuleContext) => NotificationData;
};

// Add new timed rules here.
export const TIMED_NOTIFICATION_RULES: TimedNotificationRule[] = [
  {
    id: "monday_2200_play_tomorrow",
    dayOfWeek: 1, // Monday
    hour: 22,
    minute: 0,
    title: "Yarın oynuyor musun?",
    body: (ctx) => `Şu ana kadar ${ctx.comingCount} kişi geliyorum dedi.`,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: "/attendance" }),
  },
  {
    id: "thursday_2200_play_tomorrow",
    dayOfWeek: 4, // Thursday
    hour: 22,
    minute: 0,
    title: "Yarın oynuyor musun?",
    body: (ctx) => `Şu ana kadar ${ctx.comingCount} kişi geliyorum dedi.`,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: "/attendance" }),
  },
  {
    id: "tuesday_2130_odd_players",
    dayOfWeek: 2, // Tuesday
    hour: 21,
    minute: 30,
    title: "Tek kaldık",
    body: (ctx) =>
      `Katılım şu an tek sayı (${ctx.comingCount}). Bir kişi daha lazım olabilir.`,
    // Only fires for odd numbers when we already have enough players (>= 10).
    // The under-10 case is handled separately below.
    condition: (ctx) => ctx.comingCount >= 10 && ctx.comingCount % 2 === 1,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: "/attendance" }),
  },
  {
    id: "friday_2130_odd_players",
    dayOfWeek: 5, // Friday
    hour: 21,
    minute: 30,
    title: "Tek kaldık",
    body: (ctx) =>
      `Katılım şu an tek sayı (${ctx.comingCount}). Bir kişi daha lazım olabilir.`,
    // Only fires for odd numbers when we already have enough players (>= 10).
    // The under-10 case is handled separately below.
    condition: (ctx) => ctx.comingCount >= 10 && ctx.comingCount % 2 === 1,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: "/attendance" }),
  },
  {
    id: "tuesday_2130_under_threshold",
    dayOfWeek: 2, // Tuesday
    hour: 21,
    minute: 30,
    title: "Teker tehlikede",
    body: (ctx) =>
      `Maça 1 saat kaldı ama sadece ${ctx.comingCount} kişi var. Beyler bi el atın`,
    condition: (ctx) => ctx.comingCount > 0 && ctx.comingCount < 10,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: "/attendance" }),
  },
  {
    id: "friday_2130_under_threshold",
    dayOfWeek: 5, // Friday
    hour: 21,
    minute: 30,
    title: "Teker tehlikede",
    body: (ctx) =>
      `Maça 1 saat kaldı ama sadece ${ctx.comingCount} kişi var. Beyler bi el atın`,
    condition: (ctx) => ctx.comingCount > 0 && ctx.comingCount < 10,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: "/attendance" }),
  },
];

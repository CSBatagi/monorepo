import "server-only";

import { adminDb } from "@/lib/firebaseAdmin";
import {
  emitNotificationEvent,
  type NotificationData,
} from "@/lib/serverNotifications";
import {
  TIMED_NOTIFICATION_RULES,
  type TimedRuleContext,
} from "@/lib/notificationScheduleRules";

declare global {
  // eslint-disable-next-line no-var
  var __notificationSchedulerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __notificationSchedulerTimer: NodeJS.Timeout | undefined;
}

const ISTANBUL_TZ = "Europe/Istanbul";
const SCHEDULER_INTERVAL_MS = 30_000;
const STATS_CHECK_COOLDOWN_MS = 60_000;

let lastStatsCheckAt = 0;
let lastKnownStatsTimestamp: string | null = null;
let warnedMissingBackendUrl = false;
let warnedBackendUnavailable = false;

function getIstanbulTimeParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dayOfWeek = weekdayMap[map.weekday] ?? new Date(now.toLocaleString("en-US", { timeZone: ISTANBUL_TZ })).getDay();
  const year = map.year;
  const month = map.month;
  const day = map.day;

  return {
    dayOfWeek,
    hour: Number(map.hour),
    minute: Number(map.minute),
    dateKey: `${year}-${month}-${day}`,
  };
}

async function resolveComingCount(): Promise<number> {
  const snap = await adminDb().ref("attendanceState").get();
  const attendance = (snap.val() || {}) as Record<string, { status?: string }>;
  return Object.values(attendance).filter((item) => item?.status === "coming").length;
}

async function runTimedRuleCheck() {
  if (TIMED_NOTIFICATION_RULES.length === 0) return;

  const now = new Date();
  const ist = getIstanbulTimeParts(now);
  const comingCount = await resolveComingCount();
  const ctx: TimedRuleContext = {
    now,
    dayOfWeek: ist.dayOfWeek,
    hour: ist.hour,
    minute: ist.minute,
    dateKey: ist.dateKey,
    comingCount,
  };

  for (const rule of TIMED_NOTIFICATION_RULES) {
    if (
      ctx.dayOfWeek !== rule.dayOfWeek ||
      ctx.hour !== rule.hour ||
      ctx.minute !== rule.minute
    ) {
      continue;
    }

    if (rule.condition && !rule.condition(ctx)) {
      continue;
    }

    const extraData = rule.data ? rule.data(ctx) : {};
    const linkValue = typeof extraData.link === "string" ? extraData.link : "/attendance";
    const data: NotificationData = {
      scheduleId: rule.id,
      ...extraData,
      link: linkValue,
    };
    const eventId = `timed:${rule.id}:${ctx.dateKey}`;

    await emitNotificationEvent({
      eventId,
      topic: "timed_reminders",
      title: rule.title,
      body: rule.body(ctx),
      data,
      createdByUid: "scheduler",
      createdByName: "notification-scheduler",
    });
  }
}

async function runStatsUpdateCheck() {
  const now = Date.now();
  if (now - lastStatsCheckAt < STATS_CHECK_COOLDOWN_MS) return;
  lastStatsCheckAt = now;

  const backendBase = process.env.BACKEND_INTERNAL_URL;
  if (!backendBase) {
    if (!warnedMissingBackendUrl) {
      warnedMissingBackendUrl = true;
      console.warn(
        "[notification-scheduler] BACKEND_INTERNAL_URL not set; skipping stats_updated checks."
      );
    }
    return;
  }

  const url = new URL("/stats/incremental", backendBase);
  if (lastKnownStatsTimestamp) {
    url.searchParams.set("lastKnownTs", lastKnownStatsTimestamp);
  }
  url.searchParams.set("_cb", String(now));

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
    warnedBackendUnavailable = false;
  } catch (error: any) {
    if (!warnedBackendUnavailable) {
      warnedBackendUnavailable = true;
      const details = error?.cause?.code || error?.code || error?.message || "unknown";
      console.warn(
        `[notification-scheduler] backend unreachable (${details}); skipping stats_updated checks.`
      );
    }
    return;
  }

  if (!res.ok) return;
  const data = (await res.json().catch(() => null)) as
    | { updated?: boolean; serverTimestamp?: string }
    | null;
  if (!data) return;

  if (data.serverTimestamp) {
    lastKnownStatsTimestamp = data.serverTimestamp;
  }

  if (!data.updated || !data.serverTimestamp) return;

  await emitNotificationEvent({
    eventId: `stats_updated:${data.serverTimestamp}`,
    topic: "stats_updated",
    title: "Yeni statlar basıldı",
    body: "Veritabanı güncellendi. Son istatistikler hazır.",
    data: {
      serverTimestamp: data.serverTimestamp,
      link: "/season-avg",
    },
    createdByUid: "scheduler",
    createdByName: "notification-scheduler",
  });
}

export function ensureNotificationSchedulerStarted() {
  if (process.env.ENABLE_NOTIFICATION_SCHEDULER === "false") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (global.__notificationSchedulerStarted) return;

  global.__notificationSchedulerStarted = true;
  void Promise.all([runTimedRuleCheck(), runStatsUpdateCheck()]).catch((error) => {
    console.error("[notification-scheduler] initial check failed", error);
  });

  global.__notificationSchedulerTimer = setInterval(() => {
    void Promise.all([runTimedRuleCheck(), runStatsUpdateCheck()]).catch((error) => {
      console.error("[notification-scheduler] timed check failed", error);
    });
  }, SCHEDULER_INTERVAL_MS);
}

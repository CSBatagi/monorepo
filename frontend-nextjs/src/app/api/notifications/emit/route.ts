import { NextRequest, NextResponse } from "next/server";

import { adminAuth } from "@/lib/firebaseAdmin";
import {
  type NotificationData,
  emitNotificationEvent,
  isNotificationTopic,
} from "@/lib/serverNotifications";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/authSession";

export const runtime = "nodejs";

const ISTANBUL_TZ = "Europe/Istanbul";
const TEKER_DONDU_THRESHOLD = 10;
const TEKER_DONDU_COOLDOWN_MS = 60_000;
// How long the count must stay at or above the threshold before the notification fires.
// This prevents a scroll-through (no_response → coming → not_coming) from triggering.
const TEKER_DONDU_SETTLE_MS = 10_000;

const DEFAULT_MESSAGES: Record<string, { title: string; body: string }> = {
  teker_dondu_reached: {
    title: "Teker Döndü!",
    body: "As bayrakları",
  },
  mvp_poll_locked: {
    title: "🏆 Gecenin MVP'si belirlendi",
    body: "🏆 MVP oylaması tamamlandı.",
  },
  stats_updated: {
    title: "Yeni statlar basıldı",
    body: "Veritabanı güncellendi. Son istatistikleri kontrol edin.",
  },
  timed_reminders: {
    title: "CS Batağı Hatırlatma",
    body: "Yeni bir hatırlatma var.",
  },
  admin_custom_message: {
    title: "CS Batağı",
    body: "Yeni bir duyuru var.",
  },
};

type EmitBody = {
  topic: string;
  eventId?: string;
  title?: string;
  body?: string;
  data?: NotificationData;
};

type TekerStateNode = {
  aboveThreshold?: boolean;
  crossingCount?: number;
  lastNotificationAt?: number;
  lastComingCount?: number;
  /** Timestamp (ms) when the count first crossed the threshold in the current crossing. */
  pendingSince?: number;
  updatedAt?: number;
};

function getIstanbulDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function readBearerToken(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

async function resolveComingCount(): Promise<number> {
  const BACKEND = process.env.BACKEND_INTERNAL_URL || "http://backend:3000";
  const res = await fetch(`${BACKEND}/live/attendance?v=0`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { attendance?: Record<string, { status?: string }> };
  return Object.values(data.attendance || {}).filter((item) => item?.status === "coming").length;
}

async function isMvpDateLocked(date: string): Promise<boolean> {
  const BACKEND = process.env.BACKEND_INTERNAL_URL || "http://backend:3000";
  try {
    const res = await fetch(`${BACKEND}/live/mvp-votes?v=0`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    const v = data.lockedByDate?.[date];
    if (v === true) return true;
    return !!(v && typeof v === "object" && v.locked);
  } catch {
    return false;
  }
}

// In-memory state for teker_dondu crossing detection (replaces Firebase RTDB transaction).
// Node.js is single-threaded so synchronous access is atomic. State resets on restart,
// which is acceptable — worst case a duplicate notification is sent after a deploy.
const tekerDonduState = new Map<string, TekerStateNode>();

function evaluateTekerDonduCrossing(params: {
  dateKey: string;
  comingCount: number;
}): {
  shouldSend: boolean;
  crossingCount: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number;
  pendingSettlesAt: number;
} {
  const nowTs = Date.now();
  const current = tekerDonduState.get(params.dateKey) || {};
  const previousAbove = current.aboveThreshold === true;
  const nowAbove = params.comingCount >= TEKER_DONDU_THRESHOLD;
  const previousCrossing = Number(current.crossingCount || 0);
  const lastNotificationAt = Number(current.lastNotificationAt || 0);
  const pendingSince = Number(current.pendingSince || 0);
  const elapsedSinceNotif = lastNotificationAt > 0 ? nowTs - lastNotificationAt : Number.MAX_SAFE_INTEGER;
  const inCooldown = elapsedSinceNotif < TEKER_DONDU_COOLDOWN_MS;

  let newPendingSince: number;
  if (!previousAbove && nowAbove) {
    newPendingSince = nowTs;
  } else if (previousAbove && nowAbove && pendingSince > 0) {
    newPendingSince = pendingSince;
  } else {
    newPendingSince = 0;
  }

  const settleElapsed = newPendingSince > 0 ? nowTs - newPendingSince : 0;
  const settled = settleElapsed >= TEKER_DONDU_SETTLE_MS;

  const shouldSend = nowAbove && settled && !inCooldown;
  const cooldownActive = nowAbove && settled && inCooldown;
  const cooldownRemainingMs = inCooldown ? Math.max(TEKER_DONDU_COOLDOWN_MS - elapsedSinceNotif, 0) : 0;
  const crossingCount = shouldSend ? previousCrossing + 1 : previousCrossing;
  const pendingSettlesAt = !settled && newPendingSince > 0 ? newPendingSince + TEKER_DONDU_SETTLE_MS : 0;

  tekerDonduState.set(params.dateKey, {
    aboveThreshold: nowAbove,
    crossingCount,
    pendingSince: shouldSend ? 0 : newPendingSince,
    lastComingCount: params.comingCount,
    lastNotificationAt: shouldSend ? nowTs : lastNotificationAt || 0,
    updatedAt: nowTs,
  });

  return { shouldSend, crossingCount, cooldownActive, cooldownRemainingMs, pendingSettlesAt };
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate: try HMAC session cookie first, fall back to Firebase ID token
    let uid: string;
    let displayName: string | undefined;

    const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionToken) {
      const session = verifySessionToken(sessionToken);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      uid = session.uid;
      displayName = session.name || session.email || undefined;
    } else {
      const idToken = await readBearerToken(req);
      if (!idToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const decoded = await adminAuth().verifyIdToken(idToken);
      uid = decoded.uid;
      displayName = decoded.name || decoded.email || undefined;
    }

    const body = (await req.json()) as EmitBody;
    if (!body || !isNotificationTopic(body.topic)) {
      return NextResponse.json(
        { error: "Invalid payload: topic is required." },
        { status: 400 }
      );
    }

    const topic = body.topic;
    let eventId = body.eventId?.trim() || "";
    let payloadData: NotificationData = { ...(body.data || {}) };

    if (topic === "teker_dondu_reached") {
      const comingCount = await resolveComingCount();
      const dateKey =
        typeof payloadData.dateKey === "string" && payloadData.dateKey
          ? payloadData.dateKey
          : getIstanbulDateKey(new Date());

      const crossing = evaluateTekerDonduCrossing({
        dateKey,
        comingCount,
      });

      if (!crossing.shouldSend) {
        const reason =
          comingCount < TEKER_DONDU_THRESHOLD
            ? "threshold_not_reached"
            : crossing.pendingSettlesAt > 0
              ? "settle_pending"
              : crossing.cooldownActive
                ? "cooldown_active"
                : "already_emitted_for_current_threshold_state";
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason,
          comingCount,
          cooldownRemainingMs: crossing.cooldownRemainingMs,
          // When settle_pending, tell the client exactly when to retry so it can
          // schedule a follow-up call without polling.
          ...(crossing.pendingSettlesAt > 0 && { settlesAt: crossing.pendingSettlesAt }),
        });
      }

      eventId = `teker_dondu_reached:${dateKey}:${crossing.crossingCount}`;
      payloadData = {
        ...payloadData,
        dateKey,
        comingCount,
        threshold: TEKER_DONDU_THRESHOLD,
        crossingCount: crossing.crossingCount,
        link: "/attendance",
      };
    }

    if (topic === "mvp_poll_locked") {
      const date = payloadData.date;
      if (typeof date !== "string" || !date) {
        return NextResponse.json(
          { error: "mvp_poll_locked requires data.date." },
          { status: 400 }
        );
      }
      const locked = await isMvpDateLocked(date);
      if (!locked) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "date_not_locked",
          date,
        });
      }
    }

    if (!eventId) {
      return NextResponse.json(
        { error: "Invalid payload: eventId is required for this topic." },
        { status: 400 }
      );
    }

    const fallback = DEFAULT_MESSAGES[topic] || DEFAULT_MESSAGES.timed_reminders;
    const winnerSummary =
      topic === "mvp_poll_locked" && typeof payloadData.winnerSummary === "string"
        ? payloadData.winnerSummary
        : null;
    const title = body.title?.trim() || fallback.title;
    const messageBody =
      body.body?.trim() || (winnerSummary ? `🏆 ${winnerSummary}` : fallback.body);

    const result = await emitNotificationEvent({
      eventId,
      topic,
      title,
      body: messageBody,
      data: payloadData,
      createdByUid: uid,
      createdByName: displayName,
    });

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      ...(result.dispatch || {}),
    });
  } catch (error: any) {
    console.error("[notifications/emit] failed", error);
    return NextResponse.json(
      { error: "emit_failed", details: error.message || "unknown_error" },
      { status: 500 }
    );
  }
}

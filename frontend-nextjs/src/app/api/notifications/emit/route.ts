import { NextRequest, NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import {
  NotificationData,
  emitNotificationEvent,
  isNotificationTopic,
} from "@/lib/serverNotifications";

export const runtime = "nodejs";

const TEKER_DONDU_THRESHOLD = 10;

const DEFAULT_MESSAGES: Record<string, { title: string; body: string }> = {
  teker_dondu_reached: {
    title: "Teker dondu",
    body: "Katılım 10 oyuncuya ulaştı. Hazır olun.",
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
    title: "CS Batagi Hatirlatma",
    body: "Yeni bir hatırlatma var.",
  },
  admin_custom_message: {
    title: "CS Batagi",
    body: "Yeni bir duyuru var.",
  },
};

async function readBearerToken(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

async function resolveComingCount(): Promise<number> {
  const snap = await adminDb().ref("attendanceState").get();
  const attendance = (snap.val() || {}) as Record<string, { status?: string }>;
  return Object.values(attendance).filter((item) => item?.status === "coming").length;
}

async function isMvpDateLocked(date: string): Promise<boolean> {
  const snap = await adminDb().ref(`mvpVotes/lockedByDate/${date}`).get();
  const value = snap.val();
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  return Boolean((value as { locked?: boolean }).locked);
}

type EmitBody = {
  topic: string;
  eventId: string;
  title?: string;
  body?: string;
  data?: NotificationData;
};

export async function POST(req: NextRequest) {
  try {
    const idToken = await readBearerToken(req);
    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await adminAuth().verifyIdToken(idToken);

    const body = (await req.json()) as EmitBody;
    if (!body || !isNotificationTopic(body.topic) || !body.eventId) {
      return NextResponse.json(
        { error: "Invalid payload: topic and eventId are required." },
        { status: 400 }
      );
    }

    const topic = body.topic;
    if (topic === "teker_dondu_reached") {
      const comingCount = await resolveComingCount();
      if (comingCount < TEKER_DONDU_THRESHOLD) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "threshold_not_reached",
          comingCount,
        });
      }
    }

    if (topic === "mvp_poll_locked") {
      const date = body.data?.date;
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

    const fallback = DEFAULT_MESSAGES[topic] || DEFAULT_MESSAGES.timed_reminders;
    const winnerSummary =
      topic === "mvp_poll_locked" && typeof body.data?.winnerSummary === "string"
        ? body.data.winnerSummary
        : null;
    const title = body.title?.trim() || fallback.title;
    const messageBody =
      body.body?.trim() ||
      (winnerSummary ? `🏆 ${winnerSummary}` : fallback.body);

    const result = await emitNotificationEvent({
      eventId: body.eventId,
      topic,
      title,
      body: messageBody,
      data: body.data,
      createdByUid: decoded.uid,
      createdByName: decoded.name || decoded.email || undefined,
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

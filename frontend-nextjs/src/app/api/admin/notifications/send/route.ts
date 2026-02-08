import { NextRequest, NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { emitNotificationEvent } from "@/lib/serverNotifications";

export const runtime = "nodejs";

type SendBody = {
  title?: string;
  body?: string;
};

async function readBearerToken(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function POST(req: NextRequest) {
  try {
    const idToken = await readBearerToken(req);
    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await adminAuth().verifyIdToken(idToken);
    const adminSnap = await adminDb().ref(`admins/${decoded.uid}`).get();
    if (!adminSnap.exists() || adminSnap.val() !== true) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as SendBody;
    const title = body.title?.trim();
    const messageBody = body.body?.trim();
    if (!title || !messageBody) {
      return NextResponse.json(
        { error: "title and body are required." },
        { status: 400 }
      );
    }

    const eventId = `admin_custom_message:${Date.now()}`;
    const result = await emitNotificationEvent({
      eventId,
      topic: "admin_custom_message",
      title,
      body: messageBody,
      data: { eventId, link: "/" },
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
    console.error("[admin/notifications/send] failed", error);
    return NextResponse.json(
      { error: "send_failed", details: error.message || "unknown_error" },
      { status: 500 }
    );
  }
}

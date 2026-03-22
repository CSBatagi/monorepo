import { NextRequest, NextResponse } from "next/server";

import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/authSession";

const BACKEND = process.env.BACKEND_INTERNAL_URL || "http://backend:3000";
const AUTH_TOKEN = () => process.env.AUTH_TOKEN || process.env.MATCHMAKING_TOKEN || "";

export const runtime = "nodejs";

type SendBody = {
  title?: string;
  body?: string;
};

export async function POST(req: NextRequest) {
  try {
    // Authenticate via session cookie
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const session = verifySessionToken(cookie);
    if (!session?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin status via backend PG
    const adminRes = await fetch(`${BACKEND}/admin/check/${encodeURIComponent(session.email)}`, { cache: "no-store" });
    const adminData = await adminRes.json();
    if (!adminData.isAdmin) {
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

    // Dispatch via unified backend emit endpoint
    const emitRes = await fetch(`${BACKEND}/live/notifications/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN()}`,
      },
      body: JSON.stringify({
        eventId,
        topic: "admin_custom_message",
        title,
        body: messageBody,
        data: { eventId, link: "/" },
        createdByUid: session.uid,
        createdByName: session.name || session.email || undefined,
      }),
    });

    const result = await emitRes.json();
    if (!emitRes.ok) {
      return NextResponse.json(
        { error: result.error || "emit_failed" },
        { status: emitRes.status }
      );
    }

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  } catch (error: any) {
    console.error("[admin/notifications/send] failed", error);
    return NextResponse.json(
      { error: "send_failed", details: error.message || "unknown_error" },
      { status: 500 }
    );
  }
}

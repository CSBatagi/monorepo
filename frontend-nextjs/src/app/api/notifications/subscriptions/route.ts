import { NextRequest, NextResponse } from "next/server";
import { resolveSessionUid } from "@/lib/notificationInboxServer";

const BACKEND = process.env.BACKEND_INTERNAL_URL || "http://backend:3000";
const AUTH_TOKEN = () => process.env.AUTH_TOKEN || process.env.MATCHMAKING_TOKEN || "";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const uid = resolveSessionUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });

  try {
    const res = await fetch(`${BACKEND}/live/notifications/subscriptions/${uid}/${deviceId}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const uid = resolveSessionUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const deviceId = body.deviceId;
    if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });

    const res = await fetch(`${BACKEND}/live/notifications/subscriptions/${uid}/${deviceId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN()}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const uid = resolveSessionUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const deviceId = body.deviceId;
    if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });

    const res = await fetch(`${BACKEND}/live/notifications/subscriptions/${uid}/${deviceId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN()}`,
      },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { postNotificationInbox, resolveSessionUid } from "@/lib/notificationInboxServer";

export async function GET(req: NextRequest) {
  const userUid = resolveSessionUid(req);
  if (!userUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const version = Number(req.nextUrl.searchParams.get("v") || 0);
  const limit = Number(req.nextUrl.searchParams.get("limit") || 100);

  try {
    const response = await postNotificationInbox("list", {
      userUid,
      version,
      limit,
    });
    if (response.status === 304) {
      return new Response(null, { status: 304 });
    }
    const data = await response.json();
    return NextResponse.json(data, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { postNotificationInbox, resolveSessionUid } from "@/lib/notificationInboxServer";

export async function POST(req: NextRequest) {
  const userUid = resolveSessionUid(req);
  if (!userUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await postNotificationInbox("mark-all", { userUid });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}

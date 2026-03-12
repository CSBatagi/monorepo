import { NextRequest, NextResponse } from "next/server";

import { postNotificationInbox, resolveSessionUid } from "@/lib/notificationInboxServer";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  const userUid = resolveSessionUid(req);
  if (!userUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const response = await postNotificationInbox(`${id}/read`, { userUid });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const userUid = resolveSessionUid(req);
  if (!userUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const response = await postNotificationInbox(`${id}/delete`, { userUid });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}

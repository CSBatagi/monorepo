import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    vapidKey:
      process.env.VAPID_PUBLIC_KEY ||
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
      null,
  });
}

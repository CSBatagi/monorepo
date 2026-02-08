import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    vapidKey:
      process.env.FIREBASE_VAPID_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
      null,
  });
}

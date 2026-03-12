import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/authSession";

export function resolveSessionUid(req: NextRequest): string | null {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const payload = verifySessionToken(cookie);
  return payload?.uid || null;
}

export async function postNotificationInbox(path: string, body: Record<string, unknown>) {
  const backendBase = process.env.BACKEND_INTERNAL_URL || "http://backend:3000";
  const authToken = process.env.AUTH_TOKEN || process.env.MATCHMAKING_TOKEN || "";
  return fetch(`${backendBase}/live/notifications/inbox/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
}

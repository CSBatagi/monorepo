import { NextRequest, NextResponse } from "next/server";

import { adminAuth } from "@/lib/firebaseAdmin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/authSession";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";

    if (!idToken) {
      return NextResponse.json({ error: "missing_id_token" }, { status: 400 });
    }

    await adminAuth().verifyIdToken(idToken, true);

    const expiresIn = SESSION_MAX_AGE_SECONDS * 1000;
    const sessionCookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
    const response = NextResponse.json({ ok: true });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "session_login_failed" }, { status: 401 });
  }
}

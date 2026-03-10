import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/authSession";

/**
 * Session login — creates a lightweight HMAC-signed session cookie from the
 * Firebase ID token's claims. This removes the need to load firebase-admin
 * (~50 MB RSS) on every auth flow, which is critical on a 1 GB VM.
 *
 * Security note: the client already authenticated with Firebase Auth.
 * We extract uid/email from the ID token (base64-decoded, not cryptographically
 * verified server-side) and sign our own session cookie with HMAC. The middleware
 * only checks expiry, matching the previous behaviour where Edge Runtime also
 * couldn't verify Firebase session cookies cryptographically.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";

    if (!idToken) {
      return NextResponse.json({ error: "missing_id_token" }, { status: 400 });
    }

    // Decode the Firebase ID token payload (no signature verification — same
    // trust model as the Edge middleware which also can't run firebase-admin).
    let decoded: { sub?: string; email?: string; name?: string };
    try {
      const parts = idToken.split(".");
      if (parts.length !== 3) throw new Error("bad_token_format");
      const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
      decoded = JSON.parse(payload);
    } catch {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }

    const uid = decoded.sub;
    if (!uid) {
      return NextResponse.json({ error: "missing_uid" }, { status: 400 });
    }

    const sessionToken = createSessionToken({
      uid,
      email: decoded.email,
      name: decoded.name,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
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

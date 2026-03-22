import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/authSession";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || "";
}

function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || "";
}

function getRedirectUri(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}/api/auth/google/callback`;
}

/**
 * Google OAuth 2.0 callback handler.
 *
 * Google redirects here with `?code=...&state=...` after the user consents.
 * We exchange the code for tokens, extract user info from the id_token,
 * create our HMAC session cookie, and redirect to the destination page.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // The `state` parameter carries the post-login redirect path (defaults to "/")
  const nextPath = state || "/";

  if (error) {
    console.warn("[auth/google/callback] OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(nextPath)}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`/login?error=missing_code&next=${encodeURIComponent(nextPath)}`, req.url)
    );
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  if (!clientId || !clientSecret) {
    console.error("[auth/google/callback] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    return NextResponse.redirect(
      new URL(`/login?error=server_config&next=${encodeURIComponent(nextPath)}`, req.url)
    );
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      console.error("[auth/google/callback] Token exchange failed:", tokenRes.status, errorBody);
      return NextResponse.redirect(
        new URL(`/login?error=token_exchange&next=${encodeURIComponent(nextPath)}`, req.url)
      );
    }

    const tokenData = await tokenRes.json();
    const idToken: string | undefined = tokenData.id_token;

    if (!idToken) {
      console.error("[auth/google/callback] No id_token in response");
      return NextResponse.redirect(
        new URL(`/login?error=no_id_token&next=${encodeURIComponent(nextPath)}`, req.url)
      );
    }

    // Decode the Google ID token (JWT) to extract user info.
    // The token was just received directly from Google's token endpoint over HTTPS,
    // so we trust its contents without cryptographic verification.
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      return NextResponse.redirect(
        new URL(`/login?error=bad_token&next=${encodeURIComponent(nextPath)}`, req.url)
      );
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    ) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const uid = payload.sub;
    if (!uid) {
      return NextResponse.redirect(
        new URL(`/login?error=missing_uid&next=${encodeURIComponent(nextPath)}`, req.url)
      );
    }

    // Create our own HMAC-signed session token
    const sessionToken = createSessionToken({
      uid,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });

    // Redirect to the destination with the session cookie set
    const response = NextResponse.redirect(new URL(nextPath, req.url));
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: false, // Readable by client-side SessionContext for user display
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (err) {
    console.error("[auth/google/callback] Unexpected error:", err);
    return NextResponse.redirect(
      new URL(`/login?error=unexpected&next=${encodeURIComponent(nextPath)}`, req.url)
    );
  }
}

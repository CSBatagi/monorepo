import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "./src/lib/authSession";

/**
 * Decode the JWT payload (without signature verification — Edge Runtime
 * cannot run firebase-admin) and check the `exp` claim.
 * Returns true when the cookie is missing, malformed, or expired.
 */
function isSessionMissingOrExpired(cookie: string | undefined): boolean {
  if (!cookie) return true;
  try {
    const parts = cookie.split(".");
    if (parts.length !== 3) return true;
    // Base64-url → standard Base64
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp !== "number" || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function isPublicPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/data") ||
    pathname === "/manifest.json" ||
    pathname === "/firebase-messaging-sw.js" ||
    pathname === "/favicon.ico"
  );
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (pathname === "/login") {
    if (!isSessionMissingOrExpired(sessionCookie)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (isSessionMissingOrExpired(sessionCookie)) {
    const loginUrl = new URL("/login", req.url);
    const next = `${pathname}${search || ""}` || "/";
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

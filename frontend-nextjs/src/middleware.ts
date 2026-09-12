import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Inlined to avoid pulling crypto.createHmac into the Edge Runtime bundle
// (authSession.ts imports node:crypto which is unavailable in Edge Runtime).
// Must match SESSION_COOKIE_NAME in src/lib/authSession.ts.
const SESSION_COOKIE_NAME = "csbatagi_session";

/**
 * Verify the HMAC using Edge-compatible Web Crypto and require a Steam session.
 * Returns true when the cookie is missing, malformed, or expired.
 */
async function isSessionMissingOrExpired(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return true;
  try {
    const parts = cookie.split(".");
    if (parts.length !== 3) return true;
    const secret = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
    if (!secret) return true;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return true;
    // Base64-url → standard Base64
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now() || payload.provider !== 'steam' || typeof payload.uid !== 'string' || !payload.uid || !/^7656119\d{10}$/.test(payload.steamId);
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
    pathname === "/push-sw.js" ||
    pathname === "/favicon.ico"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // Internal prewarm authenticates its own server bearer token. Browser writes
  // must have a valid Steam session before any proxy attaches that credential.
  if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !['/api/internal/stats/prewarm', '/api/session/logout'].includes(pathname)) {
    if (await isSessionMissingOrExpired(sessionCookie)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const origin = req.headers.get('origin');
    const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
    try { if (origin && new URL(origin).host !== host) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 }); }
    catch { return NextResponse.json({ error: 'Invalid origin' }, { status: 403 }); }
  }

  if (pathname === "/login") {
    if (!await isSessionMissingOrExpired(sessionCookie)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (await isSessionMissingOrExpired(sessionCookie)) {
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

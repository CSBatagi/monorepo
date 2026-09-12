import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "csbatagi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, renewed during active use

// Use an existing server-only secret. MATCHMAKING_TOKEN is always present in production.
function getSecret(): string {
  const secret = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
  if (!secret) throw new Error('Session signing secret is not configured');
  return secret;
}

/**
 * Create a lightweight session token (JWT-like 3-part format) signed with HMAC-SHA256.
 * This replaces firebase-admin's createSessionCookie, saving ~50 MB of RAM at idle
 * because firebase-admin no longer needs to be loaded on the hot auth path.
 *
 * Format: base64url(header).base64url(payload).signature
 * Node API routes and Edge middleware both verify its HMAC, Steam identity and expiry.
 */
export function createSessionToken(payload: {
  uid: string;
  steamId: string;
  provider: 'steam';
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const body = Buffer.from(
    JSON.stringify({ uid: payload.uid, steamId: payload.steamId, provider: payload.provider, email: null, name: payload.name || null, picture: payload.picture || null, exp })
  ).toString("base64url");
  const signature = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Verify a session token. Returns the payload if valid, null otherwise.
 * Used server-side in API routes that need the uid.
 */
export function verifySessionToken(
  token: string
): { uid: string; steamId: string; provider: 'steam'; email?: string | null; name?: string | null; picture?: string | null; exp: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest();
    const suppliedSig = Buffer.from(sig, 'base64url');
    if (expectedSig.length !== suppliedSig.length || !timingSafeEqual(expectedSig, suppliedSig)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now() || payload.provider !== 'steam' || typeof payload.uid !== 'string' || !payload.uid || !/^7656119\d{10}$/.test(payload.steamId)) return null;
    return payload;
  } catch {
    return null;
  }
}

import { createHmac } from "crypto";

export const SESSION_COOKIE_NAME = "csbatagi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 days

// Use an existing server-only secret. MATCHMAKING_TOKEN is always present in production.
function getSecret(): string {
  return process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN || "dev-session-secret";
}

/**
 * Create a lightweight session token (JWT-like 3-part format) signed with HMAC-SHA256.
 * This replaces firebase-admin's createSessionCookie, saving ~50 MB of RAM at idle
 * because firebase-admin no longer needs to be loaded on the hot auth path.
 *
 * Format: base64url(header).base64url(payload).signature
 * The existing middleware already parses this format (splits on ".", decodes part[1], checks exp).
 */
export function createSessionToken(payload: {
  uid: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const body = Buffer.from(
    JSON.stringify({ uid: payload.uid, email: payload.email || null, name: payload.name || null, picture: payload.picture || null, exp })
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
): { uid: string; email?: string | null; name?: string | null; picture?: string | null; exp: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

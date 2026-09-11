import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/authSession';
import { isDemoName } from '@/lib/demos';

export const runtime = 'nodejs';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';

/** Redirects a signed-in member to a short-lived signed archive URL for one demo. */
export async function GET(req: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!isDemoName(name)) return NextResponse.json({ error: 'Invalid demo name' }, { status: 400 });
  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session || !verifySessionToken(session)) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const token = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
  if (!token) return NextResponse.json({ error: 'Server authentication is not configured' }, { status: 503 });
  try {
    const response = await fetch(`${BACKEND}/demos/${encodeURIComponent(name)}/download`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Game-Session': session }, cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.url !== 'string' || !body.url.startsWith('https://storage.googleapis.com/')) {
      return NextResponse.json({ error: body.error || 'Download link is unavailable' }, { status: response.ok ? 502 : response.status });
    }
    return NextResponse.redirect(body.url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Download link request failed' }, { status: 502 });
  }
}

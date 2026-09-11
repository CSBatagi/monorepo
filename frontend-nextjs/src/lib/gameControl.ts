import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from './authSession';

export async function gameControl(req: NextRequest, endpoint: string, method = 'POST') {
  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session || !verifySessionToken(session)) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const origin = req.headers.get('origin');
  if (origin) {
    // Under output:'standalone' behind Caddy, nextUrl.host is the container's own
    // bind address, not the public host. Derive it the way the OAuth callback does.
    const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
    if (!host || new URL(origin).host !== host) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const token = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
  if (!token) return NextResponse.json({ error: 'Server authentication is not configured' }, { status: 503 });
  let body;
  if (endpoint === 'start-match' || ['cosmetics/save', 'cosmetics/unlock', 'cosmetics/award'].includes(endpoint)) {
    try { body = JSON.stringify(await req.json()); }
    catch { return NextResponse.json({ error: 'Invalid match JSON' }, { status: 400 }); }
  }
  try {
    const response = await fetch(`${process.env.BACKEND_INTERNAL_URL || 'http://backend:3000'}/${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'X-Game-Session': session, 'Content-Type': 'application/json' },
      body, cache: 'no-store', signal: AbortSignal.timeout(60000),
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: endpoint.startsWith('cosmetics/') ? 'Ekipman hizmeti yanıt vermedi. Biraz bekleyip yeniden yükleyin.' : 'Game server request failed; check status before retrying' }, { status: 502 }); }
}

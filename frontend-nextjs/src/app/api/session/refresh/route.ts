import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, verifySessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/authSession';
import { loginOrigin, loginSecret } from '@/lib/steamLoginServer';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  const origin = loginOrigin(req);
  if (req.headers.get('origin') !== origin) return reply('Invalid origin', 403);
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || '';
  const user = verifySessionToken(token);
  if (!user) return reply('invalid_session', 401);

  try {
    const memberResponse = await fetch(`${process.env.BACKEND_INTERNAL_URL || 'http://backend:3000'}/auth/steam/refresh`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.AUTH_TOKEN || loginSecret()}`, 'X-Game-Session': token },
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!memberResponse.ok) {
      const status = [401, 403].includes(memberResponse.status) ? memberResponse.status : 503;
      return reply(status === 503 ? 'account_unavailable' : 'invalid_session', status);
    }
    const member = await memberResponse.json();
    if (member.provider !== 'steam' || member.steamId !== user.steamId || member.uid !== user.uid) return reply('account_unavailable', 503);
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(member), {
      httpOnly: false, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    // A temporary outage must not destroy a still-valid remembered session.
    return reply('account_unavailable', 503);
  }
}

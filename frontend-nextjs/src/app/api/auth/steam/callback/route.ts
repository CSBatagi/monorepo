import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/authSession';
import { verifySteamLogin, STEAM_LOGIN_COOKIE } from '@/lib/steamOpenId';
import { loginOrigin, loginSecret } from '@/lib/steamLoginServer';

export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  const origin = loginOrigin(req);
  let response: NextResponse;
  try {
    const { steamId, next } = await verifySteamLogin(req.nextUrl.searchParams, req.cookies.get(STEAM_LOGIN_COOKIE)?.value, origin, loginSecret());
    let name: string | undefined, picture: string | undefined;
    if (process.env.STEAM_API_KEY) {
      try {
        const profileResponse = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
        const player = profileResponse.ok ? (await profileResponse.json()).response?.players?.[0] : null;
        if (player?.steamid === steamId) { name = player.personaname; picture = player.avatarfull; }
      } catch { /* Profile lookup is optional; SteamID is already verified. */ }
    }
    const memberResponse = await fetch(`${process.env.BACKEND_INTERNAL_URL || 'http://backend:3000'}/auth/steam/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AUTH_TOKEN || loginSecret()}`, 'X-Legacy-Session': req.cookies.get(SESSION_COOKIE_NAME)?.value || '' },
      body: JSON.stringify({ steamId, name, picture }), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!memberResponse.ok) {
      response = NextResponse.redirect(new URL(`/login?error=${memberResponse.status === 403 ? 'not_member' : 'account_unavailable'}`, origin));
    } else {
      const member = await memberResponse.json();
      if (member.provider !== 'steam' || member.steamId !== steamId || typeof member.uid !== 'string' || !member.uid) throw new Error('Invalid member response');
      response = NextResponse.redirect(new URL(next, origin));
      response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(member), { httpOnly: false, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_SECONDS });
    }
  } catch {
    response = NextResponse.redirect(new URL('/login?error=steam_login', origin));
  }
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(STEAM_LOGIN_COOKIE, '', { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/api/auth/steam', maxAge: 0 });
  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import { beginSteamLogin, STEAM_LOGIN_COOKIE } from '@/lib/steamOpenId';
import { loginOrigin, loginSecret } from '@/lib/steamLoginServer';

export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const origin = loginOrigin(req);
    const login = beginSteamLogin(origin, req.nextUrl.searchParams.get('next'), loginSecret());
    const response = NextResponse.redirect(login.url);
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(STEAM_LOGIN_COOKIE, login.cookie, { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/api/auth/steam', maxAge: login.maxAge });
    return response;
  } catch {
    return NextResponse.redirect(new URL('/login?error=server_config', loginOrigin(req)));
  }
}

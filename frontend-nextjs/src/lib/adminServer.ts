import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './authSession';

export async function checkSessionAdmin(req: NextRequest) {
  const token = process.env.AUTH_TOKEN || process.env.MATCHMAKING_TOKEN;
  if (!token) return false;
  const response = await fetch(`${process.env.BACKEND_INTERNAL_URL || 'http://backend:3000'}/auth/admin`, { headers: { Authorization: `Bearer ${token}`, 'X-Game-Session': req.cookies.get(SESSION_COOKIE_NAME)?.value || '' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
  return response.ok && (await response.json()).isAdmin === true;
}

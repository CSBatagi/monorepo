import { NextRequest } from 'next/server';

export function loginOrigin(req: NextRequest) {
  const configured = process.env.SITE_ORIGIN;
  if (configured) return new URL(configured).origin;
  return process.env.NODE_ENV === 'production' ? 'https://csbatagi.com' : req.nextUrl.origin;
}
export function loginSecret() {
  const secret = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
  if (!secret) throw new Error('Steam login session secret missing');
  return secret;
}

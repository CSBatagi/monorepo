import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/authSession';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ isAdmin: false });
  }

  const payload = verifySessionToken(cookie);
  if (!payload?.email) {
    return NextResponse.json({ isAdmin: false });
  }

  try {
    const res = await fetch(`${BACKEND}/admin/check/${encodeURIComponent(payload.email)}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json({ isAdmin: !!data.isAdmin });
  } catch {
    return NextResponse.json({ isAdmin: false });
  }
}

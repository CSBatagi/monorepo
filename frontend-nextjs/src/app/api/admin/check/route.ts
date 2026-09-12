import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/authSession';
import { checkSessionAdmin } from '@/lib/adminServer';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ isAdmin: false });
  }

  const payload = verifySessionToken(cookie);
  if (!payload) {
    return NextResponse.json({ isAdmin: false });
  }

  try {
    return NextResponse.json({ isAdmin: await checkSessionAdmin(req) });
  } catch {
    return NextResponse.json({ isAdmin: false });
  }
}

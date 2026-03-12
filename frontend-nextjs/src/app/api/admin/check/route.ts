import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/authSession';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ isAdmin: false });
  }

  const payload = verifySessionToken(cookie);
  if (!payload?.uid) {
    return NextResponse.json({ isAdmin: false });
  }

  try {
    const snap = await adminDb().ref(`admins/${payload.uid}`).get();
    const isAdmin = snap.exists() && snap.val() === true;
    return NextResponse.json({ isAdmin });
  } catch {
    return NextResponse.json({ isAdmin: false });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { loginOrigin } from '@/lib/steamLoginServer';

// Old bookmarks and in-flight Google redirects cannot create new sessions.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/login?error=steam_required', loginOrigin(req)));
}

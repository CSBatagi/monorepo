import { NextRequest, NextResponse } from 'next/server';
import { mundialDrawOperator } from '@/lib/mundialServer';

export const runtime = 'nodejs';

/** Tells the page whether the signed-in viewer may open draw balls. */
export async function GET(req: NextRequest) {
  const operator = await mundialDrawOperator(req);
  return NextResponse.json({ canOperate: !!operator }, { headers: { 'Cache-Control': 'no-store' } });
}

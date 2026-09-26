import { NextRequest, NextResponse } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export const runtime = 'nodejs';

/** Admins open or close the game VM used for demo analysis: { action: 'start' | 'stop' }. */
export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({}));
  const action = payload && typeof payload.action === 'string' ? payload.action : '';
  if (action !== 'start' && action !== 'stop') return NextResponse.json({ error: 'Geçersiz işlem.' }, { status: 400 });
  return gameControl(req, `analysis-server/${action}`, 'POST');
}

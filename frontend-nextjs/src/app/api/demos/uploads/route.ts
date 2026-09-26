import { NextRequest, NextResponse } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export const runtime = 'nodejs';

/** Starts a member upload of a demo recorded on another server; the backend validates everything. */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 }); }
  return gameControl(req, 'demo-uploads', 'POST', { body: JSON.stringify(payload) });
}

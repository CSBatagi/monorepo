import { NextRequest, NextResponse } from 'next/server';
import { gameControl } from '@/lib/gameControl';
import { isDemoName } from '@/lib/demos';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!isDemoName(name)) return NextResponse.json({ error: 'Invalid demo name' }, { status: 400 });
  // Optional analysis source override ({ source: 'matchzy' }); the backend checks it against its list.
  const payload = await req.json().catch(() => ({}));
  const source = payload && typeof payload.source === 'string' ? payload.source : undefined;
  return gameControl(req, `demos/${encodeURIComponent(name)}/analyze`, 'POST', { body: JSON.stringify(source ? { source } : {}) });
}

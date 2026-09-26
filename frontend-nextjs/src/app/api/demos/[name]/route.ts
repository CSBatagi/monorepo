import { NextRequest, NextResponse } from 'next/server';
import { gameControl } from '@/lib/gameControl';
import { isDemoName } from '@/lib/demos';

export const runtime = 'nodejs';

/** Admins remove a member upload (never a server recording) from the archive. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!isDemoName(name)) return NextResponse.json({ error: 'Invalid demo name' }, { status: 400 });
  return gameControl(req, `demos/${encodeURIComponent(name)}`, 'DELETE');
}

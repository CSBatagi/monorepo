import { NextRequest } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export const runtime = 'nodejs';
type Context = { params: Promise<{ action: string }> };
export async function GET(req: NextRequest, context: Context) {
  const { action } = await context.params;
  if (!['me', 'catalog'].includes(action)) return new Response(null, { status: 404 });
  return gameControl(req, `cosmetics/${action}${req.nextUrl.search}`, 'GET');
}
export async function POST(req: NextRequest, context: Context) {
  const { action } = await context.params;
  if (!['save', 'link-code'].includes(action)) return new Response(null, { status: 404 });
  return gameControl(req, `cosmetics/${action}`, 'POST');
}

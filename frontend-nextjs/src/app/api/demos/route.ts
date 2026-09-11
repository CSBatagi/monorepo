import { NextRequest } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  return gameControl(req, refresh ? 'demos?refresh=1' : 'demos', 'GET');
}

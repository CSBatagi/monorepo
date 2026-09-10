import { NextRequest } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export async function POST(req: NextRequest) {
  return gameControl(req, 'load-plugins', 'POST');
}

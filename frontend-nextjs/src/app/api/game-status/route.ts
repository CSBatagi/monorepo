import { NextRequest } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export async function GET(req: NextRequest) {
  return gameControl(req, 'game-status', 'GET');
}

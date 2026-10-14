import { NextRequest } from 'next/server';
import { teamSpeakControl } from '@/lib/teamSpeakControl';

export async function POST(req: NextRequest) {
  return teamSpeakControl(req, 'join');
}

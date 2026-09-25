import { NextRequest, NextResponse } from 'next/server';
import { mundialDrawOperator } from '@/lib/mundialServer';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const AUTH_TOKEN = () => process.env.AUTH_TOKEN || '';

export const runtime = 'nodejs';

// Draw actions are restricted to admins and the configured draw operators.
const DRAW_ACTIONS = ['draw-start', 'draw-next', 'draw-reset'];
const KNOCKOUT_ACTIONS = ['knockout-set', 'knockout-delete'];

export async function GET(req: NextRequest) {
  const v = req.nextUrl.searchParams.get('v') || '0';
  try {
    const res = await fetch(`${BACKEND}/live/mundial?v=${v}`, { cache: 'no-store' });
    if (res.status === 304) return new Response(null, { status: 304 });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'proxy error' }, { status: 502 });
  }
}

async function proxyPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BACKEND}/live/mundial/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { data, status: res.status };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });
    if (DRAW_ACTIONS.includes(action)) {
      const operator = await mundialDrawOperator(req);
      if (!operator) return NextResponse.json({ error: 'Kurayı yalnızca yöneticiler çekebilir.' }, { status: 403 });
      // Record who acted from the verified session, not from the request body.
      const who = { setByUid: operator.uid, setByName: operator.name || operator.steamId, byName: operator.name || operator.steamId };
      const { data, status } = await proxyPost(action, { ...body, ...who });
      return NextResponse.json(data, { status });
    }
    if (!KNOCKOUT_ACTIONS.includes(action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 });
    const { data, status } = await proxyPost(action, body);
    return NextResponse.json(data, { status });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'proxy error' }, { status: 502 });
  }
}

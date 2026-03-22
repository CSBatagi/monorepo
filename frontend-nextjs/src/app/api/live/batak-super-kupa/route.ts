import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const AUTH_TOKEN = () => process.env.AUTH_TOKEN || '';

export async function GET(req: NextRequest) {
  const v = req.nextUrl.searchParams.get('v') || '0';
  try {
    const res = await fetch(`${BACKEND}/live/batak-super-kupa?v=${v}`, { cache: 'no-store' });
    if (res.status === 304) return new Response(null, { status: 304 });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

async function proxyPost(path: string, body: any) {
  const res = await fetch(`${BACKEND}/live/batak-super-kupa/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN()}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });
    const validActions = ['set', 'delete', 'reset'];
    if (!validActions.includes(action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 });
    const data = await proxyPost(action, body);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

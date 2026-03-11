import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';

export async function GET(req: NextRequest) {
  const v = req.nextUrl.searchParams.get('v') || '0';
  try {
    const res = await fetch(`${BACKEND}/live/attendance?v=${v}`, { cache: 'no-store' });
    if (res.status === 304) {
      return new Response(null, { status: 304 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const authToken = process.env.AUTH_TOKEN || '';
    const res = await fetch(`${BACKEND}/live/attendance/${body.steamId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

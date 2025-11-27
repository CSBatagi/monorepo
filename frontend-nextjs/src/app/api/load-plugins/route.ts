import { NextRequest, NextResponse } from 'next/server';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: NextRequest) {
  const apiToken = process.env.MATCHMAKING_TOKEN;
  if (!apiToken) {
    return new NextResponse('Internal Server Error: API token not configured', { status: 500 });
  }
  const apiUrl = 'https://csbatagi.com/backend/load-plugins/';
  try {
    const apiResp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
        'User-Agent': 'Nextjs-Plugins-Proxy/1.0',
      },
      body: JSON.stringify({ trigger: true }),
    });
    const respBody = await apiResp.text();
    return new NextResponse(respBody, {
      status: apiResp.status,
      statusText: apiResp.statusText,
      headers: {
        'Content-Type': apiResp.headers.get('content-type') || 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new NextResponse('Bad Gateway: Error contacting backend', { status: 502 });
  }
}
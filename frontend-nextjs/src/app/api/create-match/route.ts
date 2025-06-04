import { NextRequest, NextResponse } from 'next/server';

export async function OPTIONS() {
  // Handle CORS preflight
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*', // Change to your domain in production!
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: NextRequest) {
  // 1. Check content type
  if (req.headers.get('content-type') !== 'application/json') {
    return new NextResponse('Unsupported Media Type: Expected application/json', { status: 415 });
  }

  // 2. Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return new NextResponse('Bad Request: Invalid JSON format', { status: 400 });
  }

  // 3. Get secret token from env
  const apiToken = process.env.MATCHMAKING_TOKEN;
  if (!apiToken) {
    return new NextResponse('Internal Server Error: API token not configured', { status: 500 });
  }

  // 4. Forward to real API
  const apiUrl = 'https://csbatagi.com/api/start-match/';
  let apiResp;
  try {
    apiResp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
        'User-Agent': 'Nextjs-Match-Proxy/1.0',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return new NextResponse('Bad Gateway: Error contacting matchmaking service', { status: 502 });
  }

  // 5. Return response to client
  const respBody = await apiResp.text();
  const resp = new NextResponse(respBody, {
    status: apiResp.status,
    statusText: apiResp.statusText,
    headers: {
      'Content-Type': apiResp.headers.get('content-type') || 'text/plain',
      'Access-Control-Allow-Origin': '*', // Change to your domain in production!
    },
  });
  return resp;
} 
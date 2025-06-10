import { NextRequest, NextResponse } from 'next/server';

export async function OPTIONS() {
  // Handle CORS preflight
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

  // 3. Check password
  const password = body?.password;
  const serverPass = process.env.SERVERACPASS;
  if (!serverPass) {
    return new NextResponse('Internal Server Error: Server password not configured', { status: 500 });
  }
  if (password !== serverPass) {
    return new NextResponse('Unauthorized: Incorrect password', { status: 401 });
  }

  // Add Authorization header like in create-match
  const apiToken = process.env.MATCHMAKING_TOKEN;
  if (!apiToken) {
    return new NextResponse('Internal Server Error: API token not configured', { status: 500 });
  }

  // Forward to real server start endpoint
  const apiUrl = 'https://csbatagi.com/backend/start-vm/';
  let apiResp;
  try {
    apiResp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'User-Agent': 'Nextjs-VM-Proxy/1.0',
      },
      // No body needed
    });
  } catch (e) {
    return new NextResponse('Bad Gateway: Error contacting server', { status: 502 });
  }

  const respBody = await apiResp.text();
  const resp = new NextResponse(respBody, {
    status: apiResp.status,
    statusText: apiResp.statusText,
    headers: {
      'Content-Type': apiResp.headers.get('content-type') || 'text/plain',
      'Access-Control-Allow-Origin': '*',
    },
  });
  return resp;
} 
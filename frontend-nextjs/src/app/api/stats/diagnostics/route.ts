import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
    const response = await fetch(`${backendUrl}/stats/diagnostics`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Backend diagnostics request failed', status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching backend diagnostics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch diagnostics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

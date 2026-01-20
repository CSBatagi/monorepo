import { NextRequest, NextResponse } from 'next/server';

// Note: Server-side admin validation should ideally use Firebase Admin SDK
// For now, we rely on client-side validation + the fact that this endpoint
// only regenerates stats (not destructive). For stricter security, add:
// 1. Firebase Admin SDK token verification
// 2. Rate limiting

export async function POST(req: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
    
    // Call backend to force stats regeneration
    const response = await fetch(`${backendUrl}/stats/force-regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: 'Backend regeneration failed', details: errorText },
        { status: 500 }
      );
    }

    const data = await response.json();

    // Delete the timestamp file to ensure next page load picks up the changes
    const fs = require('fs/promises');
    const path = require('path');
    const timestampPath = path.join(process.cwd(), 'runtime-data', 'last_timestamp.txt');
    try {
      await fs.unlink(timestampPath);
    } catch (e) {
      // File might not exist, that's ok
    }

    return NextResponse.json({
      success: true,
      message: 'Stats regenerated successfully',
      data,
    });
  } catch (error: any) {
    console.error('Error regenerating stats:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

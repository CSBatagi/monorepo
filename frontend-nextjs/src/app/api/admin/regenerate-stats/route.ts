import { checkSessionAdmin } from '@/lib/adminServer';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/authSession';
import { writeStatsSnapshotWithStatus, persistSnapshotMetadata } from '@/lib/statsSnapshot';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';

export async function POST(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie || !verifySessionToken(sessionCookie)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await checkSessionAdmin(req)) return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });

    const apiToken = process.env.MATCHMAKING_TOKEN;

    // Call backend to force stats regeneration (reuses the same MATCHMAKING_TOKEN other routes use)
    const response = await fetch(`${BACKEND}/stats/force-regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiToken ? { 'Authorization': `Bearer ${apiToken}` } : {}),
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

    // Write all JSON files to runtime-data directory
    const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
    const writeResult = await writeStatsSnapshotWithStatus(data, runtimeDir);
    if (writeResult.complete) {
      await persistSnapshotMetadata(runtimeDir, {
        statsVersion: Number(data.statsVersion || 0),
        serverTimestamp: typeof data.serverTimestamp === 'string' ? data.serverTimestamp : new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Stats regenerated and files written successfully',
      filesWritten: writeResult.written,
      snapshotComplete: writeResult.complete,
      preservedExistingDueToEmpty: writeResult.preservedExistingDueToEmpty,
      statsVersion: Number(data.statsVersion || 0),
      serverTimestamp: data.serverTimestamp,
    });
  } catch (error: any) {
    console.error('Error regenerating stats:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

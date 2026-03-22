import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/authSession';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';

// Stat files that need to be written
const STAT_FILES = [
  'season_avg.json',
  'season_avg_periods.json',
  'night_avg.json',
  'night_avg_all.json',
  'last10.json',
  'sonmac_by_date.json',
  'sonmac_by_date_all.json',
  'duello_son_mac.json',
  'duello_sezon.json',
  'performance_data.json',
  'players_stats.json',
  'players_stats_periods.json',
  'map_stats.json'
];

export async function POST(req: NextRequest) {
  try {
    // --- Auth: session cookie only ---
    let email: string | null = null;

    const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionCookie) {
      const payload = verifySessionToken(sessionCookie);
      if (payload?.email) email = payload.email;
    }

    if (!email) {
      console.warn('[regenerate-stats] Rejected: no valid auth');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin status via backend PG
    const adminRes = await fetch(`${BACKEND}/admin/check/${encodeURIComponent(email)}`, { cache: 'no-store' });
    const adminData = await adminRes.json();
    if (!adminData.isAdmin) {
      console.warn(`[regenerate-stats] Non-admin ${email} tried to regenerate stats`);
      return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
    }

    const backendUrl = BACKEND;
    const apiToken = process.env.MATCHMAKING_TOKEN;
    
    // Call backend to force stats regeneration (reuses the same MATCHMAKING_TOKEN other routes use)
    const response = await fetch(`${backendUrl}/stats/force-regenerate`, {
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
    await fs.mkdir(runtimeDir, { recursive: true });
    
    let filesWritten = [];
    let filesSkipped = [];
    
    for (const filename of STAT_FILES) {
      const key = filename.replace(/\.json$/, '');
      if (data[key] !== undefined) {
        try {
          await fs.writeFile(
            path.join(runtimeDir, filename),
            JSON.stringify(data[key]),
            'utf-8'
          );
          filesWritten.push(filename);
        } catch (writeErr: any) {
          console.error(`Failed to write ${filename}:`, writeErr.message);
        }
      } else {
        filesSkipped.push(filename);
      }
    }
    
    // Update the timestamp file with current time
    const timestampPath = path.join(runtimeDir, 'last_timestamp.txt');
    try {
      await fs.writeFile(timestampPath, data.serverTimestamp || new Date().toISOString(), 'utf-8');
    } catch (e) {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      message: 'Stats regenerated and files written successfully',
      filesWritten,
      filesSkipped,
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

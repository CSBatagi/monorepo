import fs from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { STAT_FILES, writeStatsSnapshotWithStatus, persistTimestamp } from '@/lib/statsSnapshot';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const AUTH_TOKEN = process.env.MATCHMAKING_TOKEN;
const BACKEND_TIMEOUT_MS = 30000;
const TIMESTAMP_FILE = 'last_timestamp.txt';

async function readPersistedTimestamp(runtimeDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(runtimeDir, TIMESTAMP_FILE), 'utf-8');
    return raw.trim() || null;
  } catch {
    return null;
  }
}

async function hasRuntimeStatFiles(runtimeDir: string): Promise<boolean> {
  for (const base of STAT_FILES) {
    try {
      await fs.stat(path.join(runtimeDir, base));
    } catch {
      return false;
    }
  }
  return true;
}

async function fetchIncrementalSnapshot(lastKnownTs: string | null) {
  const url = new URL('/stats/incremental', BACKEND);
  if (lastKnownTs) url.searchParams.set('lastKnownTs', lastKnownTs);
  url.searchParams.set('_cb', Date.now().toString());

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: ac.signal,
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-store',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`backend_status_${res.status}:${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!AUTH_TOKEN) {
      console.error('[stats-prewarm] MATCHMAKING_TOKEN is not configured');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
    const hadRuntimeFiles = await hasRuntimeStatFiles(runtimeDir);
    const persistedTs = hadRuntimeFiles ? await readPersistedTimestamp(runtimeDir) : null;

    let data = await fetchIncrementalSnapshot(persistedTs);

    // Cold frontend volume: ask again without lastKnownTs so we receive the full payload
    // needed to create runtime-data from scratch.
    if ((!data?.updated || typeof data !== 'object') && !hadRuntimeFiles) {
      data = await fetchIncrementalSnapshot(null);
    }

    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Invalid backend prewarm payload' }, { status: 502 });
    }

    const writeResult = data.updated
      ? await writeStatsSnapshotWithStatus(data, runtimeDir)
      : { written: [], preservedExistingDueToEmpty: [], complete: true };
    if (data.serverTimestamp && writeResult.complete) {
      await persistTimestamp(runtimeDir, data.serverTimestamp);
    }

    return NextResponse.json({
      success: true,
      updated: Boolean(data.updated),
      hadRuntimeFiles,
      filesWritten: writeResult.written,
      snapshotComplete: writeResult.complete,
      preservedExistingDueToEmpty: writeResult.preservedExistingDueToEmpty,
      serverTimestamp: data.serverTimestamp || null,
    });
  } catch (error: any) {
    console.error('[stats-prewarm] Failed to warm runtime-data:', error);
    return NextResponse.json(
      { error: 'Failed to warm runtime-data', details: error.message },
      { status: 500 }
    );
  }
}

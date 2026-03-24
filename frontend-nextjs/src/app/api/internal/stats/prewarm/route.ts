import fs from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { readSnapshotMetadata, STAT_FILES, writeStatsSnapshotWithStatus, persistSnapshotMetadata } from '@/lib/statsSnapshot';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const AUTH_TOKEN = process.env.MATCHMAKING_TOKEN;
const BACKEND_TIMEOUT_MS = 30000;
const DATASET_PAGE_MAP: Record<string, string[]> = {
  season_avg: ['/season-avg'],
  season_avg_periods: ['/season-avg'],
  last10: ['/last10'],
  night_avg: ['/gece-ortalama'],
  night_avg_all: ['/gece-ortalama', '/performans-odulleri', '/gecenin-mvpsi', '/batak-allstars'],
  sonmac_by_date: ['/sonmac', '/mac-sonuclari', '/batak-allstars'],
  sonmac_by_date_all: ['/sonmac', '/mac-sonuclari', '/batak-allstars'],
  duello_son_mac: ['/duello'],
  duello_sezon: ['/duello'],
  performance_data: ['/performance'],
  players_stats: ['/oyuncular'],
  players_stats_periods: ['/oyuncular'],
};

function collectRevalidationPaths(data: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  for (const base of STAT_FILES) {
    const key = base.replace(/\.json$/, '');
    if (data[key] === undefined) continue;
    for (const pagePath of DATASET_PAGE_MAP[key] || []) {
      paths.add(pagePath);
    }
  }
  return [...paths];
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

async function fetchIncrementalSnapshot(lastKnownVersion: number | null) {
  const url = new URL('/stats/incremental', BACKEND);
  if (lastKnownVersion && lastKnownVersion > 0) url.searchParams.set('lastKnownVersion', String(lastKnownVersion));
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
    const metadata = hadRuntimeFiles ? await readSnapshotMetadata(runtimeDir) : null;

    let data = await fetchIncrementalSnapshot(metadata?.statsVersion || null);

    // Cold frontend volume: ask again without a known published version so we receive
    // the full payload needed to create runtime-data from scratch.
    if ((!data?.updated || typeof data !== 'object') && !hadRuntimeFiles) {
      data = await fetchIncrementalSnapshot(null);
    }

    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Invalid backend prewarm payload' }, { status: 502 });
    }

    const writeResult = data.updated
      ? await writeStatsSnapshotWithStatus(data, runtimeDir)
      : { written: [], preservedExistingDueToEmpty: [], complete: true };
    if (writeResult.complete) {
      await persistSnapshotMetadata(runtimeDir, {
        statsVersion: Number(data.statsVersion || metadata?.statsVersion || 0),
        serverTimestamp: typeof data.serverTimestamp === 'string' ? data.serverTimestamp : metadata?.serverTimestamp || null,
      });
    }
    const revalidatedPaths = data.updated && writeResult.complete
      ? collectRevalidationPaths(data)
      : [];
    for (const pagePath of revalidatedPaths) {
      revalidatePath(pagePath);
    }

    return NextResponse.json({
      success: true,
      updated: Boolean(data.updated),
      hadRuntimeFiles,
      filesWritten: writeResult.written,
      snapshotComplete: writeResult.complete,
      preservedExistingDueToEmpty: writeResult.preservedExistingDueToEmpty,
      revalidatedPaths,
      statsVersion: Number(data.statsVersion || metadata?.statsVersion || 0),
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

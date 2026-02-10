import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

// Files we care about (same list as backend generates)
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
const BACKEND_TIMEOUT_MS = 5000;
const TIMESTAMP_FILE = 'last_timestamp.txt';

async function readPersistedTimestamp(runtimeDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(runtimeDir, TIMESTAMP_FILE), 'utf-8');
    const ts = raw.trim();
    return ts || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
  const url = new URL(req.url);
  const clientTs = url.searchParams.get('lastKnownTs');
  const debug = url.searchParams.get('debug') === '1';
  const persistedTs = await readPersistedTimestamp(runtimeDir);
  const effectiveLastKnownTs = clientTs || persistedTs;
  try {
    const checkUrl = new URL('/stats/incremental', backendBase);
    if (effectiveLastKnownTs) checkUrl.searchParams.set('lastKnownTs', effectiveLastKnownTs);
    // Add cache buster to avoid intermediary caching
    checkUrl.searchParams.set('_cb', Date.now().toString());
    if (debug) console.log('[stats-proxy] Fetching backend', checkUrl.toString());

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), BACKEND_TIMEOUT_MS);
    const res = await fetch(checkUrl.toString(), {
      cache: 'no-store',
      signal: ac.signal,
      headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-store' }
    }).catch(e => {
      if (debug) console.error('[stats-proxy] Network error', e);
      return new Response(JSON.stringify({ error: 'network', details: e.message }), { status: 599 });
    });
    clearTimeout(timeout);

    if (res.status === 599) {
      // Backend unreachable: try to build fallback from local runtime dir or static public data
      if (debug) console.warn('[stats-proxy] Using local fallback datasets');
      const fallback: any = { updated: false, serverTimestamp: persistedTs, backendUnavailable: true };
      const staticDir = path.join(process.cwd(), 'public', 'data');
      for (const base of STAT_FILES) {
        const key = base.replace(/\.json$/, '');
        let content: any = undefined;
        // Try runtime first
        try { const raw = await fs.readFile(path.join(runtimeDir, base), 'utf-8'); content = JSON.parse(raw); } catch {}
        if (content === undefined) {
          try { const raw = await fs.readFile(path.join(staticDir, base), 'utf-8'); content = JSON.parse(raw); } catch {}
        }
        if (content !== undefined) fallback[key] = content;
      }
      return new Response(JSON.stringify(fallback), { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
    }
    if (!res.ok) {
      let raw='';
      try { raw = await res.text(); } catch(_){}
      if (debug) console.error('[stats-proxy] Backend non-OK', res.status, raw);
      return new Response(JSON.stringify({ error: 'Backend request failed', status: res.status, backendBody: debug?raw:undefined }), { status: 500 });
    }
    let bodyText = await res.text();
    if (debug) console.log('[stats-proxy] Backend body length', bodyText.length);
    let data: any;
    try { data = JSON.parse(bodyText); } catch (e:any) {
      if (debug) console.error('[stats-proxy] JSON parse error', e.message);
      return new Response(JSON.stringify({ error: 'Invalid JSON from backend', details: e.message, raw: debug?bodyText:undefined }), { status: 500 });
    }
    // Persist only when data changed, or backfill missing files.
    await fs.mkdir(runtimeDir, { recursive: true });
    const serverTimestamp = typeof data.serverTimestamp === 'string' ? data.serverTimestamp : null;
    const canSkipFullRewrite = Boolean(serverTimestamp && serverTimestamp === persistedTs);
    if (data.updated) {
      for (const base of STAT_FILES) {
        const key = base.replace(/\.json$/, '');
        if (data[key] === undefined) continue;
        const target = path.join(runtimeDir, base);
        if (canSkipFullRewrite) {
          // Timestamp did not change, so avoid expensive rewrites.
          try { await fs.stat(target); continue; } catch {}
        }
        try { await fs.writeFile(target, JSON.stringify(data[key], null, 2), 'utf-8'); } catch {}
      }
    } else {
      // Backfill any missing file from payload (if present) or leave as-is
      for (const base of STAT_FILES) {
        const key = base.replace(/\.json$/, '');
        if (data[key] === undefined) continue;
        const target = path.join(runtimeDir, base);
        try { await fs.stat(target); } catch { try { await fs.writeFile(target, JSON.stringify(data[key], null, 2),'utf-8'); } catch {} }
      }
    }
    if (serverTimestamp && serverTimestamp !== persistedTs) {
      try {
        await fs.writeFile(path.join(runtimeDir, TIMESTAMP_FILE), serverTimestamp, 'utf-8');
      } catch {}
    }
    if (debug) console.log('[stats-proxy] Success updated=', data.updated);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json','Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Expires':'0' } });
  } catch (e: any) {
    if (debug) console.error('[stats-proxy] Unexpected error', e);
    return new Response(JSON.stringify({ error: 'Unexpected error', details: e.message }), { status: 500, headers:{'Cache-Control':'no-store'} });
  }
}

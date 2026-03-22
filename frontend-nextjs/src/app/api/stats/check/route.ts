import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { STAT_FILES } from '@/lib/statsSnapshot';

const BACKEND_TIMEOUT_MS = 30000; // 30s — stats generation on 1 GB VM can take 10-20s
const TIMESTAMP_FILE = 'last_timestamp.txt';

// --- Response cache / cooldown ---
// Prevents thundering-herd: multiple client useEffect mounts all arrive within
// milliseconds of each other; only the first one actually hits the backend.
const CHECK_COOLDOWN_MS = 90 * 1000; // 90 seconds
let cachedCheckResponse: string | null = null;
let checkCacheTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckTime = 0;

async function readPersistedTimestamp(runtimeDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(runtimeDir, TIMESTAMP_FILE), 'utf-8');
    const ts = raw.trim();
    return ts || null;
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

export async function GET(req: NextRequest) {
  // Return cached response if within cooldown window — prevents backend hammering
  const now = Date.now();
  if (cachedCheckResponse && (now - lastCheckTime < CHECK_COOLDOWN_MS)) {
    return new Response(cachedCheckResponse, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
  const url = new URL(req.url);
  const clientTs = url.searchParams.get('lastKnownTs');
  const debug = url.searchParams.get('debug') === '1';
  const persistedTs = await readPersistedTimestamp(runtimeDir);
  const hasRuntimeFiles = await hasRuntimeStatFiles(runtimeDir);
  const effectiveLastKnownTs = clientTs || (hasRuntimeFiles ? persistedTs : null);
  try {
    const checkUrl = new URL('/stats/incremental', backendBase);
    if (effectiveLastKnownTs) checkUrl.searchParams.set('lastKnownTs', effectiveLastKnownTs);
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

    if (res.status === 599 || !res.ok) {
      // Backend unreachable: build fallback from local runtime-data or static public data
      if (debug) console.warn('[stats-proxy] Backend unavailable/error (status:', res.status, '), using local fallback datasets');
      const fallback: any = { updated: false, serverTimestamp: persistedTs, backendUnavailable: true };
      const staticDir = path.join(process.cwd(), 'public', 'data');
      for (const base of STAT_FILES) {
        const key = base.replace(/\.json$/, '');
        let content: any = undefined;
        try { const raw = await fs.readFile(path.join(runtimeDir, base), 'utf-8'); content = JSON.parse(raw); } catch {}
        if (content === undefined) {
          try { const raw = await fs.readFile(path.join(staticDir, base), 'utf-8'); content = JSON.parse(raw); } catch {}
        }
        if (content !== undefined) fallback[key] = content;
      }
      const hasAnyData = STAT_FILES.some(base => fallback[base.replace(/\.json$/, '')] !== undefined);
      if (hasAnyData) fallback.updated = true;
      return new Response(JSON.stringify(fallback), { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
    }
    let bodyText = await res.text();
    if (debug) console.log('[stats-proxy] Backend body length', bodyText.length);
    let data: any;
    try { data = JSON.parse(bodyText); } catch (e:any) {
      if (debug) console.error('[stats-proxy] JSON parse error', e.message);
      return new Response(JSON.stringify({ error: 'Invalid JSON from backend', details: e.message, raw: debug?bodyText:undefined }), { status: 500 });
    }
    // Disk writes are handled by layout.tsx after() hook — this route is a pure proxy+cache.
    if (debug) console.log('[stats-proxy] Success updated=', data.updated);
    const responseBody = JSON.stringify(data);
    cachedCheckResponse = responseBody;
    lastCheckTime = Date.now();
    if (checkCacheTimer) clearTimeout(checkCacheTimer);
    checkCacheTimer = setTimeout(() => { cachedCheckResponse = null; checkCacheTimer = null; }, CHECK_COOLDOWN_MS + 5000);
    return new Response(responseBody, { status: 200, headers: { 'Content-Type': 'application/json','Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Expires':'0' } });
  } catch (e: any) {
    if (debug) console.error('[stats-proxy] Unexpected error', e);
    return new Response(JSON.stringify({ error: 'Unexpected error', details: e.message }), { status: 500, headers:{'Cache-Control':'no-store'} });
  }
}

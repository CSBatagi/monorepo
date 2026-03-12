import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

// Aggregates have a cooldown to avoid hammering the backend.
const AGG_FILES = ['season_avg.json','season_avg_periods.json','last10.json'];
let lastAggregateTime = 0;
let cachedAggregateResponse: string | null = null;
let aggCacheTimer: ReturnType<typeof setTimeout> | null = null;
const AGG_COOLDOWN_MS = 60 * 1000; // 60 seconds — backend call is cheap (in-memory check), keep cooldown short for data freshness

// Build fallback response from local runtime-data files when backend is unavailable
async function buildLocalFallback(runtimeDir: string): Promise<any | null> {
  const staticDir = path.join(process.cwd(), 'public', 'data');
  const fallback: any = { updated: true, serverTimestamp: new Date().toISOString(), backendUnavailable: true };
  let hasData = false;
  for (const base of AGG_FILES) {
    const key = base.replace(/\.json$/, '');
    let content: any = undefined;
    try { const raw = await fs.readFile(path.join(runtimeDir, base), 'utf-8'); content = JSON.parse(raw); } catch {}
    if (content === undefined) {
      try { const raw = await fs.readFile(path.join(staticDir, base), 'utf-8'); content = JSON.parse(raw); } catch {}
    }
    if (content !== undefined) { fallback[key] = content; hasData = true; }
  }
  return hasData ? fallback : null;
}

export async function GET(req: NextRequest) {
  // Return cached response if within cooldown
  const now = Date.now();
  if (cachedAggregateResponse && (now - lastAggregateTime < AGG_COOLDOWN_MS)) {
    return new Response(cachedAggregateResponse, { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
  }

  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
  const url = `${backendBase}/stats/aggregates?_cb=${Date.now()}`;
  let data: any = null;
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 15000); // 15s — cold-start generation can take 10s+ on 1 GB VM
  try {
    const res = await fetch(url, { cache: 'no-store', headers:{'Cache-Control':'no-store'}, signal: ac.signal });
    if (!res.ok) {
      // Backend returned an error — try local file fallback before giving up
      console.warn('[aggregates] Backend error (status:', res.status, '), trying local fallback');
      data = await buildLocalFallback(runtimeDir);
      if (data) {
        const responseBody = JSON.stringify(data);
        cachedAggregateResponse = responseBody;
        lastAggregateTime = Date.now();
        if (aggCacheTimer) clearTimeout(aggCacheTimer);
        aggCacheTimer = setTimeout(() => { cachedAggregateResponse = null; aggCacheTimer = null; }, AGG_COOLDOWN_MS + 5000);
        return new Response(responseBody, { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
      }
      return new Response(JSON.stringify({ error: 'backend_failed', status: res.status }), { status: 500 });
    }
    data = await res.json();
  } catch (e:any) {
    // Network error — try local file fallback
    console.warn('[aggregates] Network error, trying local fallback:', e.message);
    data = await buildLocalFallback(runtimeDir);
    if (data) {
      const responseBody = JSON.stringify(data);
      cachedAggregateResponse = responseBody;
      lastAggregateTime = Date.now();
      if (aggCacheTimer) clearTimeout(aggCacheTimer);
      aggCacheTimer = setTimeout(() => { cachedAggregateResponse = null; aggCacheTimer = null; }, AGG_COOLDOWN_MS + 5000);
      return new Response(responseBody, { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
    }
    return new Response(JSON.stringify({ error: 'network', details: e.message }), { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
  // Persist both aggregate files unconditionally because they always change logically (fresh recompute) even if identical
  await fs.mkdir(runtimeDir,{recursive:true});
  for (const base of AGG_FILES) {
    const key = base.replace(/\.json$/, '');
    if (data[key] === undefined) continue;
    const newVal = data[key];
    const isEmpty = (Array.isArray(newVal) && newVal.length === 0) ||
      (typeof newVal === 'object' && newVal !== null && !Array.isArray(newVal) && Object.keys(newVal).length === 0);
    if (isEmpty) {
      // Don't overwrite a valid file with empty data from a failed query
      const target = path.join(runtimeDir, base);
      try { await fs.stat(target); continue; } catch { /* file doesn't exist yet, write empty */ }
    }
    try { await fs.writeFile(path.join(runtimeDir, base), JSON.stringify(data[key]), 'utf-8'); } catch {}
  }
  const responseBody = JSON.stringify(data);
  cachedAggregateResponse = responseBody;
  lastAggregateTime = Date.now();
  // Free cached string after cooldown expires to avoid holding memory indefinitely
  if (aggCacheTimer) clearTimeout(aggCacheTimer);
  aggCacheTimer = setTimeout(() => { cachedAggregateResponse = null; aggCacheTimer = null; }, AGG_COOLDOWN_MS + 5000);
  return new Response(responseBody, { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
}

// Server-only helper: fetch stats datasets from backend memory.
// Used by SSR page.tsx files to always get fresh data.
// Falls back to readJson() disk files if backend unreachable.
import { readJson } from './dataReader';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const TIMEOUT_MS = 15000; // 15s — cold-start generation takes 10-20s on the 1 GB VM

// Module-level cache: avoid hitting backend for every concurrent SSR render.
// Refreshed when a new request arrives and at least 10s have passed.
let cachedData: Record<string, any> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

export async function fetchStats(...keys: string[]): Promise<Record<string, any>> {
  const now = Date.now();
  if (cachedData && (now - cachedAt < CACHE_TTL_MS)) {
    const result: Record<string, any> = {};
    for (const k of keys) result[k] = cachedData[k] ?? null;
    return result;
  }

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const res = await fetch(`${BACKEND}/stats/incremental?_cb=${now}`, {
      cache: 'no-store',
      signal: ac.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      if (data.updated && typeof data === 'object') {
        cachedData = data;
        cachedAt = now;
        const result: Record<string, any> = {};
        for (const k of keys) result[k] = data[k] ?? null;
        return result;
      }
    }
  } catch {
    // Backend unreachable — fall through to disk
  }

  const result: Record<string, any> = {};
  for (const k of keys) {
    result[k] = await readJson(`${k}.json`);
  }
  return result;
}

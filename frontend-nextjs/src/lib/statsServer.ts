// Server-only helper: fetch stats datasets from backend memory.
// Used by SSR page.tsx files to always get fresh data.
// Falls back to readJson() disk files if backend unreachable.
import fs from 'fs/promises';
import path from 'path';
import { readJson } from './dataReader';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const TIMEOUT_MS = 15000; // 15s — cold-start generation takes 10-20s on the 1 GB VM
const TIMESTAMP_FILE = 'last_timestamp.txt';

// Module-level cache: avoid hitting backend for every concurrent SSR render.
// Refreshed when a new request arrives and at least 10s have passed.
let cachedData: Record<string, any> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

function hasAllCachedKeys(keys: string[]): boolean {
  return Boolean(
    cachedData && keys.every((key) => Object.prototype.hasOwnProperty.call(cachedData, key))
  );
}

function mergeIntoCache(data: Record<string, any>, now: number) {
  cachedData = { ...(cachedData ?? {}), ...data };
  cachedAt = now;
}

async function readPersistedTimestamp(runtimeDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(runtimeDir, TIMESTAMP_FILE), 'utf-8');
    const ts = raw.trim();
    return ts || null;
  } catch {
    return null;
  }
}

async function readRuntimeJson(runtimeDir: string, key: string): Promise<any> {
  const raw = await fs.readFile(path.join(runtimeDir, `${key}.json`), 'utf-8');
  return JSON.parse(raw);
}

async function hasCompleteRuntimeSnapshot(runtimeDir: string, keys: string[]): Promise<boolean> {
  try {
    await Promise.all(keys.map((key) => fs.stat(path.join(runtimeDir, `${key}.json`))));
    return true;
  } catch {
    return false;
  }
}

async function readRuntimeSnapshot(runtimeDir: string, keys: string[]): Promise<Record<string, any>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await readRuntimeJson(runtimeDir, key)] as const)
  );
  return Object.fromEntries(entries);
}

async function fetchIncrementalSnapshot(lastKnownTs: string | null, cacheBuster: number): Promise<any> {
  const url = new URL('/stats/incremental', BACKEND);
  if (lastKnownTs) {
    url.searchParams.set('lastKnownTs', lastKnownTs);
  }
  url.searchParams.set('_cb', cacheBuster.toString());

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`stats_fetch_failed_${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchStats(...keys: string[]): Promise<Record<string, any>> {
  const now = Date.now();
  if ((now - cachedAt < CACHE_TTL_MS) && hasAllCachedKeys(keys)) {
    const result: Record<string, any> = {};
    for (const k of keys) result[k] = cachedData[k] ?? null;
    return result;
  }

  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
  const hasRuntimeSnapshot = await hasCompleteRuntimeSnapshot(runtimeDir, keys);
  const persistedTs = hasRuntimeSnapshot ? await readPersistedTimestamp(runtimeDir) : null;

  try {
    const data = await fetchIncrementalSnapshot(persistedTs, now);
    if (data && typeof data === 'object') {
      if (data.updated) {
        cachedData = data;
        cachedAt = now;
        const result: Record<string, any> = {};
        for (const k of keys) result[k] = data[k] ?? null;
        return result;
      }

      // Backend confirmed nothing changed — serve from runtime-data (fast path).
      // Populate the module cache so concurrent SSR renders don't repeat network+disk I/O.
      if (persistedTs && hasRuntimeSnapshot) {
        try {
          const runtimeResult = await readRuntimeSnapshot(runtimeDir, keys);
          mergeIntoCache(runtimeResult, now);
          return runtimeResult;
        } catch {
          // Runtime snapshot was expected but is unreadable; fall through to full backend fetch.
        }
      }
    }

    // Either backend returned updated:false without a usable runtime snapshot,
    // or the runtime read failed. Force a full payload (no lastKnownTs).
    const fullData = await fetchIncrementalSnapshot(null, now + 1);
    if (fullData && fullData.updated && typeof fullData === 'object') {
      cachedData = fullData;
      cachedAt = now;
      const result: Record<string, any> = {};
      for (const k of keys) result[k] = fullData[k] ?? null;
      return result;
    }
  } catch {
    // Backend unreachable — fall through to disk
  }

  if (hasRuntimeSnapshot) {
    try {
      const runtimeResult = await readRuntimeSnapshot(runtimeDir, keys);
      mergeIntoCache(runtimeResult, now);
      return runtimeResult;
    } catch {
      // Fall through to generic disk fallback.
    }
  }

  const result: Record<string, any> = {};
  for (const k of keys) {
    result[k] = await readJson(`${k}.json`);
  }
  mergeIntoCache(result, now);
  return result;
}

// Server-only helper: fetch stats datasets from backend memory.
// Used by SSR page.tsx files to always get fresh data.
// Falls back to readJson() disk files if backend unreachable.
import fs from 'fs/promises';
import path from 'path';
import { readJson } from './dataReader';
import { readSnapshotMetadata } from './statsSnapshot';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
const TIMEOUT_MS = 15000; // 15s — cold-start generation takes 10-20s on the 1 GB VM

// Module-level cache: avoid hitting backend for every concurrent SSR render.
//
// Entries are tracked per key, each with its own timestamp and the stats version
// it was read from. Both matter: a single shared timestamp let a key that was
// never re-read ride on a TTL that other keys kept refreshing, so a page asking
// for several datasets at once (team-picker wants last10 + season_avg) could pair
// a fresh dataset with an arbitrarily old one and disagree with the single-dataset
// pages. Requiring one common version on top of the TTL keeps a multi-key read
// internally consistent — every dataset a page renders describes the same
// snapshot.
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  value: unknown;
  at: number;
  version: number | null;
}

const cachedEntries = new Map<string, CacheEntry>();

/**
 * Returns the requested keys only when every one of them is cached, unexpired,
 * and belongs to the same stats version. Any miss returns null so the caller
 * refetches the whole set together.
 */
function readCachedKeys(keys: string[], now: number): Record<string, unknown> | null {
  if (!keys.length) return null;
  const result: Record<string, unknown> = {};
  let version: number | null | undefined;
  for (const key of keys) {
    const entry = cachedEntries.get(key);
    if (!entry || now - entry.at >= CACHE_TTL_MS) return null;
    if (version === undefined) version = entry.version;
    else if (version !== entry.version) return null;
    result[key] = entry.value ?? null;
  }
  return result;
}

function mergeIntoCache(data: Record<string, unknown>, now: number, version: number | null) {
  for (const [key, value] of Object.entries(data)) {
    cachedEntries.set(key, { value, at: now, version });
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

function versionOf(data: Record<string, unknown>): number | null {
  const version = Number(data?.statsVersion);
  return Number.isFinite(version) && version > 0 ? version : null;
}

async function fetchIncrementalSnapshot(lastKnownVersion: number | null, cacheBuster: number): Promise<any> {
  const url = new URL('/stats/incremental', BACKEND);
  if (lastKnownVersion && lastKnownVersion > 0) {
    url.searchParams.set('lastKnownVersion', String(lastKnownVersion));
  }
  url.searchParams.set('_cb', cacheBuster.toString());

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      // Use next.revalidate instead of cache:'no-store' to avoid
      // "Page changed from static to dynamic" errors in Next.js 15 ISR pages.
      // Our module-level cache (10s TTL) handles freshness independently.
      next: { revalidate: 60 },
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
  const cached = readCachedKeys(keys, now);
  if (cached) return cached;

  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
  const hasRuntimeSnapshot = await hasCompleteRuntimeSnapshot(runtimeDir, keys);
  const metadata = hasRuntimeSnapshot ? await readSnapshotMetadata(runtimeDir) : null;
  const persistedVersion = metadata?.statsVersion || 0;

  const takeKeys = (data: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const k of keys) result[k] = data[k] ?? null;
    return result;
  };

  try {
    const data = await fetchIncrementalSnapshot(persistedVersion || null, now);
    if (data && typeof data === 'object') {
      if (data.updated) {
        mergeIntoCache(data, now, versionOf(data));
        return takeKeys(data);
      }

      // Backend confirmed nothing changed — serve from runtime-data (fast path).
      // Populate the module cache so concurrent SSR renders don't repeat network+disk I/O.
      if (hasRuntimeSnapshot) {
        try {
          const runtimeResult = await readRuntimeSnapshot(runtimeDir, keys);
          mergeIntoCache(runtimeResult, now, persistedVersion || null);
          return runtimeResult;
        } catch {
          // Runtime snapshot was expected but is unreadable; fall through to full backend fetch.
        }
      }
    }

    // Either backend returned updated:false without a usable runtime snapshot,
    // or the runtime read failed. Force a full payload (no lastKnownVersion).
    const fullData = await fetchIncrementalSnapshot(null, now + 1);
    if (fullData && fullData.updated && typeof fullData === 'object') {
      mergeIntoCache(fullData, now, versionOf(fullData));
      return takeKeys(fullData);
    }
  } catch {
    // Backend unreachable — fall through to disk
  }

  if (hasRuntimeSnapshot) {
    try {
      const runtimeResult = await readRuntimeSnapshot(runtimeDir, keys);
      mergeIntoCache(runtimeResult, now, persistedVersion || null);
      return runtimeResult;
    } catch {
      // Fall through to generic disk fallback.
    }
  }

  const result: Record<string, any> = {};
  for (const k of keys) {
    result[k] = await readJson(`${k}.json`);
  }
  // Version unknown on this path: cache the keys together under a null version so
  // they stay mutually consistent but never pair with versioned entries.
  mergeIntoCache(result, now, null);
  return result;
}

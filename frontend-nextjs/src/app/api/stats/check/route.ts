import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import {
  persistSnapshotMetadata,
  readSnapshotMetadata,
  STAT_FILES,
  writeStatsSnapshotWithStatus,
} from '@/lib/statsSnapshot';

const BACKEND_TIMEOUT_MS = 30000;

// Prevents thundering-herd: multiple client useEffect mounts all arrive within
// milliseconds of each other; only the first one actually hits the backend.
const CHECK_COOLDOWN_MS = 10 * 1000;

type CheckResult = {
  key: string;
  body: string;
  status: number;
  headers: Record<string, string>;
};

const STAT_DATA_KEYS = new Set(STAT_FILES.map((base) => base.replace(/\.json$/, '')));

function parseRequestedKeys(raw: string | null): string[] {
  if (!raw) return [];
  const unique = new Set<string>();
  for (const key of raw.split(',')) {
    const normalized = key.trim();
    if (STAT_DATA_KEYS.has(normalized)) unique.add(normalized);
  }
  return [...unique].sort();
}

function filterStatsPayload(data: Record<string, any>, requestedKeys: string[]): Record<string, any> {
  if (!requestedKeys.length) return data;
  const filtered: Record<string, any> = {
    updated: Boolean(data.updated),
    statsVersion: data.statsVersion,
    serverTimestamp: data.serverTimestamp ?? null,
  };
  if (data.backendUnavailable) filtered.backendUnavailable = true;
  if (data.__errors) filtered.__errors = data.__errors;
  for (const key of requestedKeys) {
    if (data[key] !== undefined) filtered[key] = data[key];
  }
  return filtered;
}

let cachedCheckResult: CheckResult | null = null;
let checkCacheTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckTime = 0;
let inFlightCheck: { key: string; promise: Promise<CheckResult> } | null = null;

function jsonResult(
  key: string,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): CheckResult {
  return {
    key,
    body: JSON.stringify(data),
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  };
}

function toResponse(result: CheckResult) {
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}

function storeCachedResult(result: CheckResult) {
  cachedCheckResult = result;
  lastCheckTime = Date.now();
  if (checkCacheTimer) clearTimeout(checkCacheTimer);
  checkCacheTimer = setTimeout(() => {
    cachedCheckResult = null;
    checkCacheTimer = null;
  }, CHECK_COOLDOWN_MS + 5000);
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

async function buildLocalFallback(
  key: string,
  runtimeDir: string,
  metadata: Awaited<ReturnType<typeof readSnapshotMetadata>>,
  requestedKeys: string[],
): Promise<CheckResult> {
  const fallback: Record<string, unknown> = {
    updated: false,
    statsVersion: metadata?.statsVersion || 0,
    serverTimestamp: metadata?.serverTimestamp || null,
    backendUnavailable: true,
  };
  const staticDir = path.join(process.cwd(), 'public', 'data');
  const filesToRead = requestedKeys.length
    ? requestedKeys.map((keyName) => `${keyName}.json`).filter((base) => STAT_FILES.includes(base))
    : STAT_FILES;

  for (const base of filesToRead) {
    const dataKey = base.replace(/\.json$/, '');
    let content: unknown = undefined;
    try {
      const raw = await fs.readFile(path.join(runtimeDir, base), 'utf-8');
      content = JSON.parse(raw);
    } catch {}
    if (content === undefined) {
      try {
        const raw = await fs.readFile(path.join(staticDir, base), 'utf-8');
        content = JSON.parse(raw);
      } catch {}
    }
    if (content !== undefined) fallback[dataKey] = content;
  }

  const hasAnyData = filesToRead.some((base) => fallback[base.replace(/\.json$/, '')] !== undefined);
  if (hasAnyData) fallback.updated = true;
  return jsonResult(key, fallback);
}

async function persistUpdatedSnapshot(
  data: Record<string, any>,
  runtimeDir: string,
  metadata: Awaited<ReturnType<typeof readSnapshotMetadata>>,
) {
  if (!data.updated) return;

  try {
    const writeResult = await writeStatsSnapshotWithStatus(data, runtimeDir);
    if (writeResult.complete) {
      await persistSnapshotMetadata(runtimeDir, {
        statsVersion: Number(data.statsVersion || metadata?.statsVersion || 0),
        serverTimestamp: typeof data.serverTimestamp === 'string'
          ? data.serverTimestamp
          : metadata?.serverTimestamp || null,
      });
    } else {
      console.warn('[stats-check] runtime snapshot preserved old files; skipping metadata persist', {
        preservedExistingDueToEmpty: writeResult.preservedExistingDueToEmpty,
      });
    }
  } catch (error: any) {
    console.error('[stats-check] Failed to persist runtime snapshot:', error?.message || error);
  }
}

async function executeCheck({
  key,
  backendBase,
  runtimeDir,
  effectiveLastKnownVersion,
  debug,
  metadata,
  requestedKeys,
}: {
  key: string;
  backendBase: string;
  runtimeDir: string;
  effectiveLastKnownVersion: string | null;
  debug: boolean;
  metadata: Awaited<ReturnType<typeof readSnapshotMetadata>>;
  requestedKeys: string[];
}): Promise<CheckResult> {
  const checkUrl = new URL('/stats/incremental', backendBase);
  if (effectiveLastKnownVersion) checkUrl.searchParams.set('lastKnownVersion', effectiveLastKnownVersion);
  checkUrl.searchParams.set('_cb', Date.now().toString());
  if (debug) console.log('[stats-proxy] Fetching backend', checkUrl.toString());

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), BACKEND_TIMEOUT_MS);
  const res = await fetch(checkUrl.toString(), {
    cache: 'no-store',
    signal: ac.signal,
    headers: { Pragma: 'no-cache', 'Cache-Control': 'no-store' },
  }).catch((error) => {
    if (debug) console.error('[stats-proxy] Network error', error);
    return new Response(JSON.stringify({ error: 'network', details: error.message }), { status: 599 });
  });
  clearTimeout(timeout);

  if (res.status === 599 || !res.ok) {
    if (debug) {
      console.warn('[stats-proxy] Backend unavailable/error (status:', res.status, '), using local fallback datasets');
    }
    return buildLocalFallback(key, runtimeDir, metadata, requestedKeys);
  }

  const bodyText = await res.text();
  if (debug) console.log('[stats-proxy] Backend body length', bodyText.length);

  let data: Record<string, any>;
  try {
    data = JSON.parse(bodyText);
  } catch (error: any) {
    if (debug) console.error('[stats-proxy] JSON parse error', error.message);
    return jsonResult(
      key,
      { error: 'Invalid JSON from backend', details: error.message, raw: debug ? bodyText : undefined },
      500,
    );
  }

  await persistUpdatedSnapshot(data, runtimeDir, metadata);

  if (debug) console.log('[stats-proxy] Success updated=', data.updated);
  return jsonResult(key, filterStatsPayload(data, requestedKeys), 200, {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
}

export async function GET(req: NextRequest) {
  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
  const url = new URL(req.url);
  const clientVersion = url.searchParams.get('lastKnownVersion');
  const requestedKeys = parseRequestedKeys(url.searchParams.get('keys'));
  const requestedKeyPart = requestedKeys.length ? requestedKeys.join(',') : 'all';
  const debug = url.searchParams.get('debug') === '1';
  const now = Date.now();

  // Normal client polling includes lastKnownVersion. In that common case the
  // cache key is knowable without touching runtime-data, so hot cache hits stay
  // zero-I/O.
  const clientCacheKey = clientVersion ? `${clientVersion}:${requestedKeyPart}:${debug ? 'debug' : 'normal'}` : null;
  if (clientCacheKey && cachedCheckResult?.key === clientCacheKey && now - lastCheckTime < CHECK_COOLDOWN_MS) {
    return toResponse(cachedCheckResult);
  }
  if (clientCacheKey && inFlightCheck?.key === clientCacheKey) {
    try {
      return toResponse(await inFlightCheck.promise);
    } catch (error: any) {
      return toResponse(jsonResult(clientCacheKey, { error: 'Unexpected error', details: error.message }, 500));
    }
  }

  const metadata = await readSnapshotMetadata(runtimeDir);
  const hasRuntimeFiles = clientVersion ? false : await hasRuntimeStatFiles(runtimeDir);
  const effectiveLastKnownVersion =
    clientVersion || (hasRuntimeFiles && metadata?.statsVersion ? String(metadata.statsVersion) : null);
  const cacheKey = `${effectiveLastKnownVersion || 'none'}:${requestedKeyPart}:${debug ? 'debug' : 'normal'}`;

  if (cachedCheckResult?.key === cacheKey && now - lastCheckTime < CHECK_COOLDOWN_MS) {
    return toResponse(cachedCheckResult);
  }

  if (inFlightCheck?.key === cacheKey) {
    try {
      return toResponse(await inFlightCheck.promise);
    } catch (error: any) {
      return toResponse(jsonResult(cacheKey, { error: 'Unexpected error', details: error.message }, 500));
    }
  }

  try {
    const promise = executeCheck({
      key: cacheKey,
      backendBase,
      runtimeDir,
      effectiveLastKnownVersion,
      debug,
      metadata,
      requestedKeys,
    });
    inFlightCheck = { key: cacheKey, promise };
    const result = await promise;
    if (result.status === 200) storeCachedResult(result);
    return toResponse(result);
  } catch (error: any) {
    if (debug) console.error('[stats-proxy] Unexpected error', error);
    return toResponse(jsonResult(cacheKey, { error: 'Unexpected error', details: error.message }, 500));
  } finally {
    if (inFlightCheck?.key === cacheKey) {
      inFlightCheck = null;
    }
  }
}

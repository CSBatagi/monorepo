'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface UseLivePollingOptions<T> {
  url: string;
  intervalMs?: number;
  enabled?: boolean;
  initialData: T;
}

interface UseLivePollingResult<T> {
  data: T;
  loading: boolean;
  version: number;
  error: string | null;
  /** Re-fetch immediately, bypassing the version check (forces fresh data). */
  refetch: () => Promise<void>;
}

/**
 * Polls a /api/live/* endpoint at a fixed interval.
 * Uses version-based 304 responses to minimize data transfer.
 * Replaces Firebase RTDB onValue listeners with local PostgreSQL-backed polling.
 */
export function useLivePolling<T>({
  url,
  intervalMs = 3000,
  enabled = true,
  initialData,
}: UseLivePollingOptions<T>): UseLivePollingResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const mountedRef = useRef(true);
  const loadingRef = useRef(true);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;
    try {
      const v = forceRefresh ? 0 : versionRef.current;
      const res = await fetch(`${url}?v=${v}`);
      if (res.status === 304) {
        // No changes
        if (mountedRef.current && loadingRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!mountedRef.current) return;
      if (typeof json.version === 'number') {
        versionRef.current = json.version;
      }
      // Remove 'version' from the data passed to consumers
      const { version: _, ...rest } = json;
      setData(rest as unknown as T);
      setError(null);
      if (loadingRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e.message);
        if (loadingRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    }
  }, [url, enabled]);

  const refetch = useCallback(() => {
    // Reset the polling interval so the next scheduled poll is pushed back,
    // avoiding a redundant request right after this manual refetch.
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = setInterval(fetchData, intervalMs);
    }
    return fetchData(true);
  }, [fetchData, intervalMs]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    // When (re-)enabled, mark as loading until the first fetch resolves.
    // Without this, the UI briefly shows default/empty data with no indicator
    // between the moment `enabled` flips true and the first response arrives.
    if (!loadingRef.current && versionRef.current === 0) {
      loadingRef.current = true;
      setLoading(true);
    }

    // Initial fetch immediately
    fetchData();

    // Set up polling interval
    intervalIdRef.current = setInterval(fetchData, intervalMs);

    return () => {
      mountedRef.current = false;
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [url, intervalMs, enabled, fetchData]);

  return { data, loading, version: versionRef.current, error, refetch };
}

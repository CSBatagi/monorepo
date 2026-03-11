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

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    // Initial fetch immediately
    fetchData();

    // Set up polling interval
    const id = setInterval(fetchData, intervalMs);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [url, intervalMs, enabled, fetchData]);

  return { data, loading, version: versionRef.current, error, refetch };
}

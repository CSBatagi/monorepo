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
 * Version-validated live reads. Only one scheduled request runs at a time;
 * explicit post-write refreshes supersede any older read already in flight.
 */
export function useLivePolling<T>({
  url,
  intervalMs = 3000,
  enabled = true,
  initialData,
}: UseLivePollingOptions<T>): UseLivePollingResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refetch = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let currentVersion = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    let hasSnapshot = false;
    let failures = 0;
    let lastStarted = -Infinity;
    const visible = () => document.visibilityState !== 'hidden';
    const clearTimer = () => { clearTimeout(timer); timer = undefined; };
    const cancel = () => {
      clearTimer();
      const previous = active;
      active = null;
      previous?.abort();
      lastStarted = -Infinity;
    };

    setData(initialDataRef.current);
    setVersion(0);
    setError(null);
    setLoading(enabled);
    if (!enabled) return;

    async function fetchData(force = false): Promise<void> {
      if (disposed || (!force && (!visible() || active))) return;
      clearTimer();
      // A mutation refresh must begin AFTER the mutation, never reuse an older read.
      active?.abort();
      const controller = new AbortController();
      active = controller;
      lastStarted = Date.now();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const separator = url.includes('?') ? '&' : '?';
        const res = await fetch(`${url}${separator}v=${force ? 0 : currentVersion}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (res.status === 304 && (!hasSnapshot || force)) {
          throw new Error('Live data snapshot missing');
        }
        if (res.status !== 304) {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          // Handles PostgreSQL BIGINT strings from older backend deployments too.
          const nextVersion = Number(json.version);
          if (!Number.isSafeInteger(nextVersion) || nextVersion < 0) {
            throw new Error('Invalid live version');
          }
          if (disposed || active !== controller || controller.signal.aborted) return;
          const { version: _, ...rest } = json;
          currentVersion = nextVersion;
          hasSnapshot = true;
          setVersion(nextVersion);
          setData(rest as T);
        }
        if (!disposed && active === controller && !controller.signal.aborted) {
          setError(null);
          setLoading(false);
          failures = 0;
        }
      } catch (e: unknown) {
        if (!disposed && active === controller) {
          failures++;
          setError(controller.signal.aborted ? 'Live data request timed out' :
            e instanceof Error ? e.message : 'Live data request failed');
          setLoading(false);
        }
      } finally {
        clearTimeout(timeout);
        if (!disposed && active === controller) {
          active = null;
          // Recover a failed first read promptly, then back off during outages.
          const delay = failures ? Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000) : intervalMs;
          if (visible()) timer = setTimeout(() => { void fetchData(); }, delay);
        }
      }
    }

    refreshRef.current = () => fetchData(true);
    const resume = () => {
      if (!visible()) { cancel(); return; }
      // A suspended browser can retain a request whose timeout has not run yet.
      if (active && Date.now() - lastStarted >= 15000) cancel();
      if (!active && Date.now() - lastStarted >= 1000) void fetchData();
    };
    const offline = () => cancel();
    void fetchData();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', resume);
    return () => {
      disposed = true;
      clearTimer();
      active?.abort();
      refreshRef.current = async () => {};
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', resume);
    };
  }, [url, intervalMs, enabled]);

  return { data, loading, version, error, refetch };
}

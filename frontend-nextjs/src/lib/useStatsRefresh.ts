'use client';

import { useEffect, useMemo, useRef } from 'react';

interface UseStatsRefreshOptions {
  /** Called when fresh data arrives from the backend (updated === true). Extract your keys here. */
  onData: (payload: Record<string, any>) => void;
  /** Called after the fetch completes regardless of updated status. Use for clearing loading state. */
  onSettled?: () => void;
  /** Enable all refresh behavior. Default: true. */
  enabled?: boolean;
  /** Run a check immediately after mount. Default: same as enabled. */
  checkOnMount?: boolean;
  /** Re-check when a mobile PWA/browser tab returns to the foreground. Default: true. */
  refreshOnResume?: boolean;
  /** Minimum time between foreground-triggered checks for the same key set. Default: 30s. */
  minIntervalMs?: number;
  /** Dataset keys this client can consume. The global stats version still controls freshness. */
  keys?: string[];
}

const lastRefreshAttemptByKey = new Map<string, number>();

/**
 * Shared client-side stats refresh hook.
 * Fetches /api/stats/check, manages localStorage stats_version,
 * and refreshes installed mobile/PWA sessions when they resume from the background.
 */
export function useStatsRefresh({
  onData,
  onSettled,
  enabled = true,
  checkOnMount,
  refreshOnResume = true,
  minIntervalMs = 30_000,
  keys = [],
}: UseStatsRefreshOptions) {
  const onDataRef = useRef(onData);
  const onSettledRef = useRef(onSettled);
  const keyParam = useMemo(() => keys.join(','), [keys]);
  const shouldCheckOnMount = checkOnMount ?? enabled;

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let inFlight = false;
    const refreshKey = keyParam || 'all';

    async function checkForStatsUpdate(force = false) {
      if (cancelled || inFlight) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const now = Date.now();
      const lastAttempt = lastRefreshAttemptByKey.get(refreshKey) || 0;
      if (!force && now - lastAttempt < minIntervalMs) return;

      lastRefreshAttemptByKey.set(refreshKey, now);
      inFlight = true;

      try {
        const lastKnownVersion = localStorage.getItem('stats_version');
        const params = new URLSearchParams();
        if (lastKnownVersion) params.set('lastKnownVersion', lastKnownVersion);
        if (keyParam) params.set('keys', keyParam);
        params.set('_cb', String(now));

        const response = await fetch(`/api/stats/check?${params.toString()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' },
        });
        if (!response.ok) return;

        const data = await response.json();
        if (cancelled) return;

        if (data.statsVersion) {
          try { localStorage.setItem('stats_version', String(data.statsVersion)); } catch {}
        }
        if (data.updated) {
          onDataRef.current(data);
        }
      } catch {
        // The next foreground event will retry; callers only need loading cleared.
      } finally {
        inFlight = false;
        if (!cancelled) onSettledRef.current?.();
      }
    }

    if (shouldCheckOnMount) {
      void checkForStatsUpdate(true);
    }

    if (!refreshOnResume) {
      return () => { cancelled = true; };
    }

    const handleVisible = () => {
      if (document.visibilityState === 'visible') void checkForStatsUpdate();
    };
    const handleFocus = () => {
      void checkForStatsUpdate();
    };
    const handlePageShow = () => {
      void checkForStatsUpdate();
    };

    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [enabled, keyParam, minIntervalMs, refreshOnResume, shouldCheckOnMount]);
}

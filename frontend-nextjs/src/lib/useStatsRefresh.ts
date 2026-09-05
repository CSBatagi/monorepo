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
  /**
   * Background poll cadence while the page is visible. Installed PWAs keep a
   * single document alive for the whole session, so without this an open page
   * only ever refreshes on resume events — which iOS standalone apps fire
   * unreliably. Set to 0/null to disable. Default: 90s.
   */
  pollIntervalMs?: number | null;
  /** Dataset keys this client can consume. The global stats version still controls freshness. */
  keys?: string[];
}


/**
 * Shared client-side stats refresh hook.
 * Fetches /api/stats/check with the version actually received by this consumer,
 * and refreshes installed mobile/PWA sessions when they resume from the background.
 */
export function useStatsRefresh({
  onData,
  onSettled,
  enabled = true,
  checkOnMount,
  refreshOnResume = true,
  minIntervalMs = 30_000,
  pollIntervalMs = 90_000,
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
    // Coalesces the burst of resume events (visibilitychange + focus + pageshow
    // often fire together) so a single return-to-foreground triggers one check.
    let lastForcedAt = 0;
    // A global/localStorage version says nothing about this mounted page's data.
    // Start unversioned so stale ISR props and newly opened tabs are refreshed.
    let receivedVersion: string | null = null;
    let lastAttempt = 0;

    async function checkForStatsUpdate(force = false) {
      if (cancelled || inFlight) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const now = Date.now();
      if (force) {
        if (now - lastForcedAt < 3_000) return;
        lastForcedAt = now;
      } else {
        if (now - lastAttempt < minIntervalMs) return;
      }

      lastAttempt = now;
      inFlight = true;

      try {
        const lastKnownVersion = receivedVersion;
        const params = new URLSearchParams();
        // Explicit zero prevents the proxy substituting its disk snapshot version.
        params.set('lastKnownVersion', lastKnownVersion || '0');
        if (keyParam) params.set('keys', keyParam);
        params.set('_cb', String(now));

        const response = await fetch(`/api/stats/check?${params.toString()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' },
        });
        if (!response.ok) return;

        const data = await response.json();
        if (cancelled) return;

        if (data.updated) {
          onDataRef.current(data);
          if (data.statsVersion) receivedVersion = String(data.statsVersion);
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

    // Background poll keeps an already-open page fresh without a resume event.
    // Throttled (force=false) so it never beats minIntervalMs, and paused while
    // the page is hidden so a backgrounded PWA does no network work.
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (pollTimer || !pollIntervalMs) return;
      pollTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void checkForStatsUpdate();
        }
      }, pollIntervalMs);
    };
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      startPolling();
    }

    if (!refreshOnResume) {
      return () => { cancelled = true; stopPolling(); };
    }

    // Force on resume so the 30s throttle can't swallow the one check that
    // matters most — the user just brought the app back to the foreground.
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkForStatsUpdate(true);
        startPolling();
      } else {
        stopPolling();
      }
    };
    const handleFocus = () => {
      void checkForStatsUpdate(true);
    };
    const handlePageShow = () => {
      void checkForStatsUpdate(true);
    };

    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [enabled, keyParam, minIntervalMs, pollIntervalMs, refreshOnResume, shouldCheckOnMount]);
}

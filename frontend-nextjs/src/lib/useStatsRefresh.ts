'use client';

import { useEffect } from 'react';

interface UseStatsRefreshOptions {
  /** Called when fresh data arrives from the backend (updated === true). Extract your keys here. */
  onData: (payload: Record<string, any>) => void;
  /** Called after the fetch completes regardless of updated status. Use for clearing loading state. */
  onSettled?: () => void;
  /** Skip the fetch entirely (e.g. SSR data was sufficient). Default: true. */
  enabled?: boolean;
}

/**
 * Shared client-side stats refresh hook.
 * Fetches /api/stats/check on mount, manages localStorage timestamp,
 * and calls onData when the backend reports updated data.
 */
export function useStatsRefresh({ onData, onSettled, enabled = true }: UseStatsRefreshOptions) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const lastKnownVersion = localStorage.getItem('stats_version');
    const url = `/api/stats/check${lastKnownVersion ? `?lastKnownVersion=${encodeURIComponent(lastKnownVersion)}&` : '?'}_cb=${Date.now()}`;
    fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.statsVersion) {
          try { localStorage.setItem('stats_version', String(data.statsVersion)); } catch {}
        }
        if (data.updated) {
          try { onData(data); } finally { onSettled?.(); }
        } else {
          onSettled?.();
        }
      })
      .catch(() => {
        if (!cancelled) onSettled?.();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

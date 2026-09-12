'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Read-only requests: recover from a cold/unavailable server without replaying writes. */
export function useRecoveringRead<T>({ url, onData, enabled = true, debounceMs = 0 }: {
  url: string;
  onData: (data: T) => void;
  enabled?: boolean;
  debounceMs?: number;
}) {
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const callback = useRef(onData);
  callback.current = onData;
  const refresh = useRef<() => Promise<void>>(async () => {});
  const refetch = useCallback(() => refresh.current(), []);

  useEffect(() => {
    let disposed = false;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastStarted = -Infinity;
    const visible = () => document.visibilityState !== 'hidden';
    const cancel = () => {
      clearTimeout(timer);
      const previous = active;
      active = null;
      previous?.abort();
      lastStarted = -Infinity;
    };
    setLoading(enabled);
    setError('');
    if (!enabled) return;

    async function read(force = false): Promise<void> {
      if (disposed || !visible() || (!force && active)) return;
      cancel();
      const controller = new AbortController();
      active = controller;
      lastStarted = Date.now();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let retry = true;
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        // Expired sessions and forbidden reads require user action, not a retry loop.
        retry = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(response.status === 401 ? 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.' :
            body?.error || 'Veriler yüklenemedi.');
        }
        retry = true;
        const data = await response.json() as T;
        if (disposed || active !== controller || controller.signal.aborted) return;
        callback.current(data);
        failures = 0;
        setError('');
      } catch (e) {
        if (disposed || active !== controller) return;
        failures++;
        setError(controller.signal.aborted ? 'Veriler gecikti. Otomatik olarak tekrar deneniyor…' :
          e instanceof Error ? e.message : 'Veriler yüklenemedi.');
        if (retry && visible()) {
          const delay = Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000);
          timer = setTimeout(() => { void read(); }, delay);
        }
      } finally {
        clearTimeout(timeout);
        if (!disposed && active === controller) {
          active = null;
          setLoading(false);
        }
      }
    }

    refresh.current = () => read(true);
    const resume = () => {
      if (!visible()) { cancel(); return; }
      // Coalesce focus/pageshow/visibility events from the same navigation.
      if (active && Date.now() - lastStarted >= 15000) cancel();
      if (active || Date.now() - lastStarted < 1000) return;
      void read();
    };
    const offline = () => cancel();
    if (debounceMs) timer = setTimeout(() => { void read(); }, debounceMs);
    else void read();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    return () => {
      disposed = true;
      cancel();
      refresh.current = async () => {};
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
    };
  }, [url, enabled, debounceMs]);

  return { loading, error, refetch };
}

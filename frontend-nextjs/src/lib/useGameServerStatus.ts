'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type GameStatus = {
  warmup: boolean; live: boolean; preparing: boolean; recording: boolean; demoFailed: boolean; paused?: boolean;
  map: string; humans: number; bytes: number;
  uploads?: { pending: number; updatedAt?: number; demos: { name: string; state: string }[] };
};

/** offline covers both a stopped VM and one that is still booting: the game
 *  server answers RCON only once CS2 itself is up, so the two look identical
 *  from here. The caller knows which it asked for and can say so. */
export type GamePhase = 'loading' | 'online' | 'offline' | 'unauthorized';

const IDLE_INTERVAL = 15000;
const SETTLING_INTERVAL = 5000;

/** Polls the game server status. Pass settling=true while a start/stop is in
 *  flight to check more often until the server reaches its new state. */
export function useGameServerStatus(settling = false) {
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);
  const generation = useRef(0);
  const settlingRef = useRef(settling);
  settlingRef.current = settling;

  const refresh = useCallback(async () => {
    // Only the newest poll may schedule the next one, so an out-of-band refresh
    // replaces the running chain instead of starting a second one.
    const mine = ++generation.current;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const response = await fetch(`${basePath}/api/game-status`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (disposed.current) return;
      if (response.status === 401 || response.status === 403) { setStatus(null); setPhase('unauthorized'); }
      else if (!response.ok) { setStatus(null); setPhase('offline'); }
      else { setStatus(await response.json()); setPhase('online'); }
    } catch {
      if (!disposed.current) { setStatus(null); setPhase('offline'); }
    }
    if (!disposed.current && generation.current === mine) {
      timer.current = setTimeout(refresh, settlingRef.current ? SETTLING_INTERVAL : IDLE_INTERVAL);
    }
  }, []);

  useEffect(() => {
    disposed.current = false;
    void refresh();
    return () => { disposed.current = true; if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  // Entering the settling state should not wait out the idle interval.
  const wasSettling = useRef(settling);
  useEffect(() => {
    if (settling && !wasSettling.current) void refresh();
    wasSettling.current = settling;
  }, [settling, refresh]);

  return { status, phase, refresh };
}

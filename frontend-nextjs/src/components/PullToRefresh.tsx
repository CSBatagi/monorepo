'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// Pull distance (px, after resistance) needed to trigger a refresh.
const TRIGGER_DISTANCE = 70;
// Cap on how far the indicator travels so a long drag doesn't run off-screen.
const MAX_PULL = 110;
// Finger travel is damped by this factor so the pull feels weighty, not 1:1.
const RESISTANCE = 0.5;

/**
 * Custom pull-to-refresh for the installed PWA.
 *
 * iOS standalone PWAs have no browser chrome and therefore no native
 * pull-to-refresh at all; on Android the native gesture is suppressed via
 * `overscroll-behavior-y: contain` (globals.css) so behaviour is identical on
 * both. A pull from the top past the threshold reloads the document, which
 * re-runs SSR and remounts every client with fresh data.
 */
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs mirror state for use inside the (once-registered) touch handlers,
  // avoiding re-binding listeners on every drag frame.
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const atTop = () =>
      (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const setPullVal = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      dragging.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (refreshingRef.current || startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        if (dragging.current) {
          dragging.current = false;
          setPullVal(0);
        }
        return;
      }
      if (!atTop()) {
        startY.current = null;
        if (dragging.current) {
          dragging.current = false;
          setPullVal(0);
        }
        return;
      }
      dragging.current = true;
      setPullVal(Math.min(MAX_PULL, dy * RESISTANCE));
      // Suppress native overscroll/bounce while we own the gesture.
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (refreshingRef.current) return;
      if (dragging.current && pullRef.current >= TRIGGER_DISTANCE) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullVal(TRIGGER_DISTANCE);
        // Let the spinner paint before the synchronous reload tears down the page.
        window.setTimeout(() => window.location.reload(), 150);
      } else {
        setPullVal(0);
      }
      startY.current = null;
      dragging.current = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(1, pull / TRIGGER_DISTANCE);
  const offset = (refreshing ? TRIGGER_DISTANCE : pull) - 44;

  return (
    <div
      aria-hidden={!visible}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
        opacity: visible ? 1 : 0,
        transform: `translateY(${offset}px)`,
        transition: dragging.current ? 'none' : 'transform 0.2s ease, opacity 0.2s ease',
      }}
    >
      <div
        style={{
          marginTop: 'calc(8px + env(safe-area-inset-top, 0px))',
          width: 36,
          height: 36,
          borderRadius: '9999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(37, 99, 235, 0.95)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        }}
      >
        <RefreshCw
          size={20}
          color="#ffffff"
          style={{
            transform: `rotate(${progress * 270}deg)`,
            animation: refreshing ? 'ptr-spin 0.8s linear infinite' : 'none',
          }}
        />
      </div>
    </div>
  );
}

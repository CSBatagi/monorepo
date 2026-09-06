'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { chooseTier, type SceneQuality } from './camera-path';

type Props = { progress: RefObject<number>; motion: boolean; detail: boolean; quality: SceneQuality };

export default function CinematicScene({ progress, motion, detail, quality }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ motion, detail });
  const wake = useRef<() => void>(() => {});
  const sceneTime = useRef(2.4);
  const cameraPosition = useRef(0);
  live.current = { motion, detail };

  useEffect(() => {
    const element = stage.current, surface = canvas.current;
    if (!element || !surface) return;
    const hardware = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const saveData = hardware.connection?.saveData === true;
    element.dataset.renderer = 'poster';
    // No engine download or GPU allocation in still mode / data saver.
    if (quality === 'static' || (saveData && quality === 'auto')) return;
    let disposed = false, frame = 0, bootTimer = 0, lastTime = 0, lastFrame = 0;
    let pointerX = 0, pointerY = 0, smoothX = 0, smoothY = 0;
    let framesMeasured = 0, totalCost = 0, throttled = false;
    let engine: ReturnType<typeof import('./breach-renderer').createBreachRenderer> | undefined;
    const tier = chooseTier(quality, window.innerWidth, hardware.hardwareConcurrency, hardware.deviceMemory);
    element.dataset.quality = tier;
    const halt = () => { cancelAnimationFrame(frame); frame = 0; lastTime = lastFrame = 0; };
    const paint = (now: number) => {
      frame = 0;
      if (disposed || document.hidden || !engine) return;
      const animate = live.current.motion && !live.current.detail;
      const interval = throttled ? 1000 / 24 : tier === 'low' ? 1000 / 30 : 1000 / 60;
      if (lastFrame && now - lastFrame < interval - 1) { frame = requestAnimationFrame(paint); return; }
      const elapsed = lastTime ? Math.min(now - lastTime, 80) : 16;
      lastTime = lastFrame = now;
      if (animate) sceneTime.current += elapsed / 1000;
      const ease = 1 - Math.exp(-elapsed / 230);
      if (animate) {
        cameraPosition.current += (progress.current - cameraPosition.current) * ease;
        smoothX += (pointerX - smoothX) * ease; smoothY += (pointerY - smoothY) * ease;
      } else if (live.current.detail) cameraPosition.current = progress.current;
      const start = performance.now();
      engine.draw(sceneTime.current, cameraPosition.current, smoothX, smoothY);
      element.dataset.renderer = 'webgl';
      // Downshift once after sustained expensive frames; never oscillate tiers.
      if (animate && !throttled) {
        totalCost += performance.now() - start; framesMeasured++;
        if (framesMeasured === 60) {
          if (totalCost / framesMeasured > (tier === 'low' ? 18 : 23)) { engine.degrade(); throttled = true; element.dataset.quality = 'adaptive'; }
          framesMeasured = totalCost = 0;
        }
      }
      if (animate) frame = requestAnimationFrame(paint);
    };
    const resume = () => { halt(); if (!document.hidden && engine) frame = requestAnimationFrame(paint); };
    wake.current = resume;
    const resize = () => { engine?.resize(window.innerWidth, window.innerHeight); resume(); };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || tier === 'low') return;
      pointerX = (event.clientX / window.innerWidth - .5) * 2;
      pointerY = (event.clientY / window.innerHeight - .5) * 2;
    };
    const resetPointer = () => { pointerX = pointerY = 0; };
    const contextLost = (event: Event) => {
      event.preventDefault(); halt(); element.dataset.renderer = 'poster';
      // Keep navigation usable after GPU eviction; don't repeatedly reclaim it.
      disposed = true;
    };
    surface.addEventListener('webglcontextlost', contextLost);
    surface.addEventListener('scene-assets-ready', resume);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', pointer, { passive: true });
    document.addEventListener('pointerleave', resetPointer);
    document.addEventListener('visibilitychange', resume);
    // Let useful page content paint before loading this opt-in client-only chunk.
    bootTimer = window.setTimeout(() => {
      void import('./breach-renderer').then(({ createBreachRenderer }) => {
        if (disposed) return;
        engine = createBreachRenderer(surface, tier);
        resize();
      }).catch(() => { element.dataset.renderer = 'poster'; });
    }, 80);
    return () => {
      disposed = true; halt(); window.clearTimeout(bootTimer); wake.current = () => {};
      window.removeEventListener('resize', resize); window.removeEventListener('pointermove', pointer);
      document.removeEventListener('pointerleave', resetPointer); document.removeEventListener('visibilitychange', resume);
      surface.removeEventListener('webglcontextlost', contextLost);
      surface.removeEventListener('scene-assets-ready', resume);
      engine?.dispose();
    };
  }, [progress, quality]);

  useEffect(() => { wake.current(); }, [motion, detail]);

  return <div ref={stage} className={`cinema-scene ${detail ? 'is-detail' : ''}`} aria-hidden="true" data-renderer="poster">
    <div className="cinema-artwork" />
    <div className="cinema-scene-light" />
    <canvas key={quality} ref={canvas} className="cinema-webgl" />
    <div className="cinema-scene-shade" />
    <div className="cinema-grain" />
  </div>;
}

'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { cameraFrames } from './chapters';
import { Battlefield } from './battlefield';

export default function CinematicScene({ progress, motion, detail }: {
  progress: RefObject<number>; motion: boolean; detail: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneTime = useRef(2.4);
  const cameraPosition = useRef(0);

  useEffect(() => {
    const element = stage.current, surface = canvas.current;
    if (!element || !surface) return;
    const ctx = surface.getContext('2d');
    const battlefield = ctx ? new Battlefield(ctx) : null;
    let width = 1, height = 1, frame = 0, lastTime = 0;
    let pointerX = 0, pointerY = 0, smoothX = 0, smoothY = 0;
    // Mouse parallax never fires on a touch screen and the landing view opens unscrolled,
    // so there the camera drifts on its own to keep the opening frame alive. A real mouse
    // move hands the camera back for good, so a pointer the media query missed still wins.
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    let steered = false;
    const paint = (time: number) => {
      const dt = lastTime ? Math.min(time - lastTime, 50) : 0;
      lastTime = time;
      if (motion) sceneTime.current += dt / 1000;
      const easing = 1 - Math.exp(-Math.max(dt, 16) / 180);
      if (motion) {
        cameraPosition.current += (progress.current - cameraPosition.current) * easing;
        if (!steered && !fine.matches) { pointerX = Math.sin(sceneTime.current * .19) * .85; pointerY = Math.sin(sceneTime.current * .13 + 1.1) * .6; }
        smoothX += (pointerX - smoothX) * easing; smoothY += (pointerY - smoothY) * easing;
      }
      const bounded = Math.max(0, Math.min(3, cameraPosition.current));
      const index = Math.min(2, Math.floor(bounded)), t = bounded - index;
      const a = cameraFrames[index], b = cameraFrames[index + 1];
      const mix = (key: keyof typeof a) => a[key] + (b[key] - a[key]) * t;
      element.style.setProperty('--camera-x', `${mix('x') + smoothX * .7}%`);
      element.style.setProperty('--camera-y', `${mix('y') + smoothY * .6}%`);
      element.style.setProperty('--camera-scale', `${mix('scale')}`);
      element.style.setProperty('--camera-roll', `${mix('roll')}deg`);
      battlefield?.draw(width, height, sceneTime.current, { yaw: mix('yaw') + smoothX * .04, pitch: smoothY * .03, roll: mix('roll') * Math.PI / 180, travel: (mix('scale') - 1) * 450 });
      if (motion && !document.hidden) frame = requestAnimationFrame(paint);
    };
    const resize = () => {
      width = surface.clientWidth || window.innerWidth; height = surface.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, width < 700 ? 1 : 1.5);
      surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      cancelAnimationFrame(frame); lastTime = 0; paint(0);
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      steered = true;
      pointerX = (event.clientX / width - .5) * 2; pointerY = (event.clientY / height - .5) * 2;
    };
    const resetPointer = () => { pointerX = pointerY = 0; };
    const visibility = () => { cancelAnimationFrame(frame); lastTime = 0; if (!document.hidden) paint(0); };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', pointer, { passive: true });
    document.addEventListener('pointerleave', resetPointer);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', pointer); document.removeEventListener('pointerleave', resetPointer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [progress, motion]);

  return <div ref={stage} className={`cinema-scene ${detail ? 'is-detail' : ''}`} aria-hidden="true">
    <div className="cinema-artwork" /><div className="cinema-scene-shade" />
    <canvas ref={canvas} className="cinema-particles" />
    <div className="cinema-grain" />
  </div>;
}

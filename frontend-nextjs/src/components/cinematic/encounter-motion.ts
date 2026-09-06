export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export const shots = [1.28, 1.46, 1.72, 1.91];

/** Scroll is the encounter clock. Every pose can be evaluated in either direction. */
export function encounterAt(progress: number, ct: boolean, support = false) {
  const p = clamp(progress, 0, 3), delay = support ? .12 : 0;
  const advance = smooth((p - delay) / .88) * 1.3;
  const reposition = smooth((p - 2.25 - delay) / .65) * .65;
  const distance = advance - reposition;
  const moving = (p > delay && p < .88 + delay) || (p > 2.25 + delay && p < 2.9 + delay);
  const walkBlend = smooth((p-delay)/.08)*(1-smooth((p-.8-delay)/.08)) + smooth((p-2.25-delay)/.08)*(1-smooth((p-2.82-delay)/.08));
  const crouch = smooth((p - .86 - delay) / .3) * .19 * (1 - smooth((p - 2.2) / .2));
  const fire = shots.filter((_, i) => (i % 2 === 0) === ct);
  const recoil = fire.reduce((value, shot) => Math.max(value, Math.max(0, 1 - Math.abs(p - shot - (support ? .035 : 0)) / .065)), 0);
  const flash = fire.some(shot => p >= shot && p < shot + .024) && !support;
  return { p, distance, moving, crouch, recoil, flash, aim: 1 - walkBlend * .18, stage: p < .9 ? 'advance' : p < 1.2 ? 'take-cover' : p < 2.2 ? 'exchange' : 'reposition' };
}

/** 60% planted, 40% swing. During support the foot stays at a fixed ground point. */
export function footAt(distance: number, left: boolean) {
  const stride = .65, offset = left ? 0 : .5;
  const cycle = distance / stride + offset, index = Math.floor(cycle + 1e-8), fraction = cycle - index;
  const swing = clamp((fraction - .6) / .4);
  return { forward: (index - offset + smooth(swing)) * stride - distance, lift: Math.sin(swing * Math.PI) * .15, planted: fraction <= .6 };
}

export function impactAt(progress: number, index: number) {
  const shot = shots[index % shots.length] + .025;
  const age = clamp((progress - shot) * 2.6, 0, 2.8);
  return { age, active: progress >= shot, airborne: age < 1.45 };
}

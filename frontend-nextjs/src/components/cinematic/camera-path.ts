export type SceneQuality = 'auto' | 'lite' | 'static';
export type RenderTier = 'high' | 'low';

// Establishing shot, opposing side, close breach, final overhead tactical view.
// Native scroll is the clock; the camera travels around actual geometry.
export const breachCameraFrames = [
  { x: 7, y: 4.6, z: 14, targetY: 1.65, roll: -.018 },
  { x: -7, y: 3.6, z: 11.8, targetY: 1.7, roll: .025 },
  { x: 2.8, y: 2.8, z: 10.5, targetY: 1.8, roll: -.025 },
  { x: 7.5, y: 10.8, z: 12.8, targetY: .8, roll: 0 },
] as const;

export function cameraAt(progress: number) {
  const p = Math.max(0, Math.min(3, Number.isFinite(progress) ? progress : 0));
  const index = Math.min(2, Math.floor(p)), t = p - index;
  const eased = t * t * (3 - 2 * t);
  const a = breachCameraFrames[index], b = breachCameraFrames[index + 1];
  const mix = (key: keyof typeof a) => a[key] + (b[key] - a[key]) * eased;
  return { x: mix('x'), y: mix('y'), z: mix('z'), targetY: mix('targetY'), roll: mix('roll') };
}

export function chooseTier(preference: SceneQuality, width: number, cores?: number, memory?: number): RenderTier {
  return preference === 'lite' || width < 760 || (cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4) ? 'low' : 'high';
}

export function renderPixelRatio(width: number, height: number, deviceRatio: number, tier: RenderTier) {
  const budget = tier === 'low' ? 850_000 : 1_900_000;
  return Math.min(Math.max(.5, deviceRatio || 1), tier === 'low' ? 1 : 1.5, Math.sqrt(budget / Math.max(1, width * height)));
}

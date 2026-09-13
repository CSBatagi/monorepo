/** Shared by monthly awards and the last-night briefing. */
export function performanceScore(hltvDiff: number, adrDiff: number): number {
  return hltvDiff * 70 + adrDiff;
}

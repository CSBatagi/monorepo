// Single source of truth for runtime-data stat file list and snapshot writing.
// Used by layout.tsx (after-hook writer) and admin/regenerate-stats (manual writer).
import path from 'path';
import fs from 'fs/promises';

export const STAT_FILES = [
  'season_avg.json',
  'season_avg_periods.json',
  'last10.json',
  'night_avg.json',
  'night_avg_all.json',
  'sonmac_by_date.json',
  'sonmac_by_date_all.json',
  'duello_son_mac.json',
  'duello_sezon.json',
  'performance_data.json',
  'players_stats.json',
  'players_stats_periods.json',
  'map_stats.json',
];

/**
 * Write stat datasets from a backend response to runtime-data/ on disk.
 * Skips empty arrays/objects to avoid overwriting valid files with failed-query blanks.
 * Returns the list of filenames actually written.
 */
export async function writeStatsSnapshot(
  data: Record<string, any>,
  runtimeDir: string,
): Promise<string[]> {
  await fs.mkdir(runtimeDir, { recursive: true });
  const written: string[] = [];
  for (const base of STAT_FILES) {
    const key = base.replace(/\.json$/, '');
    if (data[key] === undefined) continue;
    const val = data[key];
    // Guard: don't overwrite a valid file with empty data from a failed query
    const isEmpty =
      (Array.isArray(val) && val.length === 0) ||
      (typeof val === 'object' && val !== null && !Array.isArray(val) && Object.keys(val).length === 0);
    if (isEmpty) {
      const target = path.join(runtimeDir, base);
      try { await fs.stat(target); continue; } catch { /* file doesn't exist yet, write empty */ }
    }
    try {
      await fs.writeFile(path.join(runtimeDir, base), JSON.stringify(val), 'utf-8');
      written.push(base);
    } catch {}
  }
  return written;
}

/** Persist the backend serverTimestamp to last_timestamp.txt */
export async function persistTimestamp(runtimeDir: string, ts: string): Promise<void> {
  try {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDir, 'last_timestamp.txt'), ts, 'utf-8');
  } catch {}
}

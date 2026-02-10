import path from 'path';
import fs from 'fs/promises';

// Helper to read JSON files, preferring runtime-data volume for dynamic files
export async function readJson(filename: string): Promise<any> {
  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');

  // Static files (always in public/data)
  const staticFiles = ['kabile.json', 'maps.json', 'players.json', 'season_start.json'];
  
  if (staticFiles.includes(filename)) {
    // For static files, only check public/data locations
    const candidates = [
      path.join(process.cwd(), 'public/data', filename)
    ];
    
    for (const p of candidates) {
      try {
        const raw = await fs.readFile(p, 'utf-8');
        return JSON.parse(raw);
      } catch (_) { /* continue */ }
    }
    return {};
  }
  
  // Dynamic files (prefer runtime-data, fallback to public/data for build time)
  const candidates = [
    path.join(runtimeDir, filename),
    path.join(process.cwd(), 'public/data', filename)
  ];
  
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw);
    } catch (e) { 
      /* continue */ 
    }
  }
  
  // Return appropriate defaults for different file types
  if (filename.includes('season_avg_periods') || filename.includes('players_stats_periods') || filename.includes('sonmac_by_date_all') || filename.includes('night_avg_all')) {
    return {};
  } else if (filename.includes('last10') || filename.includes('season_avg') || filename.includes('players_stats') || filename.includes('map_stats')) {
    return [];
  } else if (filename.includes('night_avg') || filename.includes('sonmac_by_date')) {
    return {};
  } else if (filename.includes('duello')) {
    return { playerRows: [], playerCols: [], duels: {} };
  } else if (filename.includes('performance_data')) {
    return [];
  }
  
  return {};
}

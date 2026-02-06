export type NightAvgRow = {
  steam_id: string;
  name?: string;
  [key: string]: unknown;
};

export type NightAvgData = Record<string, NightAvgRow[]>;

export type SonmacPlayer = {
  name?: string;
  steam_id: string;
  [key: string]: unknown;
};

export type SonmacTeam = {
  name?: string;
  score?: number;
  players?: SonmacPlayer[];
};

export type SonmacMap = {
  team1?: SonmacTeam;
  team2?: SonmacTeam;
};

export type SonmacNight = {
  maps?: Record<string, SonmacMap>;
};

export type SonmacByDate = Record<string, SonmacNight>;

export type CaptainRecord = {
  steamId: string;
  steamName?: string;
  date: string;
  teamKey?: 'team1' | 'team2';
  teamName?: string;
  setByUid?: string;
  setByName?: string;
  setAt?: number;
};

export type CaptainsByDateSnapshot = Record<
  string,
  {
    team1?: CaptainRecord | null;
    team2?: CaptainRecord | null;
  }
>;

export type PlayersIndex = {
  bySteamId: Record<string, { steam_id: string; name?: string }>; // from players.json
  byNameLower: Record<string, { steam_id: string; name?: string }>;
};

export type AllStarsConfig = {
  version: number;
  notes?: Record<string, string>;
  scoring: {
    useStat: string; // "HLTV 2"
    seriesPoints: {
      '2-0W': number;
      '2-1W': number;
      '1-1D': number;
      '2-1L': number;
      '2-0L': number;
    };
    tokenRule?: {
      dropWorstNights?: 'captainTokens';
    };
  };
  leagues: Array<{
    id: string;
    name: string;
    players: string[]; // steamId list
  }>;
};

export type PlayerStanding = {
  steamId: string;
  name: string;
  oyn: number; // nights played
  kpt: number; // captain tokens
  puanRaw: number; // avg over all played nights
  puanAdj: number; // avg after dropping worst kpt nights
  nightBreakdown?: Array<{ date: string; hltv2: number; bonus: number; points: number; dropped: boolean }>;
  meetsKriteria?: boolean; // true if 5+ matches and 1+ captaincy
  positionChange?: 'up' | 'down' | 'same' | 'new'; // Position change compared to previous night
};

export function buildPlayersIndex(playersJson: unknown): PlayersIndex {
  const arr: unknown[] = Array.isArray(playersJson) ? playersJson : [];
  const bySteamId: PlayersIndex['bySteamId'] = {};
  const byNameLower: PlayersIndex['byNameLower'] = {};
  for (const p of arr) {
    const obj = (typeof p === 'object' && p !== null) ? (p as Record<string, unknown>) : null;
    const steamIdRaw = obj ? (obj.steam_id ?? obj.steamId) : '';
    const steam_id = String(steamIdRaw || '').trim();
    const nameRaw = obj ? obj.name : '';
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!steam_id) continue;
    bySteamId[steam_id] = { steam_id, name };
    if (name) byNameLower[name.toLowerCase()] = { steam_id, name };
  }
  return { bySteamId, byNameLower };
}

export function displayNameForSteamId(steamId: string, index: PlayersIndex): string {
  const p = index.bySteamId[steamId];
  return (p?.name || steamId).trim();
}

// Analyzes maps for a night and returns which maps are "main league" vs "casual third match"
function getMainLeagueMapsForDate(sonmacByDate: SonmacByDate, date: string): string[] | null {
  const night = date ? sonmacByDate?.[date] : null;
  const maps = night?.maps;
  if (!maps) return null;

  const mapNames = Object.keys(maps);
  if (mapNames.length <= 2) {
    // 2 or fewer maps - all are main league
    return mapNames;
  }

  if (mapNames.length === 3) {
    // 3 maps - check if the 3rd map has different teams than the first 2
    const map1 = maps[mapNames[0]];
    const map2 = maps[mapNames[1]];
    const map3 = maps[mapNames[2]];

    if (!map1?.team1?.name || !map1?.team2?.name || !map2?.team1?.name || !map2?.team2?.name ||
        !map3?.team1?.name || !map3?.team2?.name) {
      // If we can't get team names, include all maps
      return mapNames;
    }

    // Check if first 2 maps have the same teams (in any order)
    const teams12Set1 = new Set([map1.team1.name, map1.team2.name]);
    const teams12Set2 = new Set([map2.team1.name, map2.team2.name]);
    const teams3Set = new Set([map3.team1.name, map3.team2.name]);

    const maps12SameTeams = teams12Set1.size === teams12Set2.size && 
                           [...teams12Set1].every(team => teams12Set2.has(team));

    if (maps12SameTeams) {
      // Check if map 3 has different teams
      const map3DifferentTeams = teams3Set.size !== teams12Set1.size ||
                                ![...teams3Set].every(team => teams12Set1.has(team));
      
      if (map3DifferentTeams) {
        // Map 3 is a casual match - only count first 2 maps
        return mapNames.slice(0, 2);
      }
    }
  }

  // Default: include all maps
  return mapNames;
}

// Modified version of deriveTeamsForDate that only considers main league maps
function deriveMainLeagueTeamsForDate(sonmacByDate: SonmacByDate, date: string): {
  team1Name: string;
  team2Name: string;
  team1Players: Array<{ steamId: string; name?: string }>;
  team2Players: Array<{ steamId: string; name?: string }>;
  mapWinsTeam1: number;
  mapWinsTeam2: number;
} | null {
  const night = date ? sonmacByDate?.[date] : null;
  const allMaps = night?.maps;
  if (!allMaps) return null;

  const mainLeagueMapNames = getMainLeagueMapsForDate(sonmacByDate, date);
  if (!mainLeagueMapNames || mainLeagueMapNames.length === 0) return null;

  // Filter to only main league maps
  const maps: Record<string, any> = {};
  for (const mapName of mainLeagueMapNames) {
    if (allMaps[mapName]) {
      maps[mapName] = allMaps[mapName];
    }
  }

  const team1Players: Array<{ steamId: string; name?: string }> = [];
  const team2Players: Array<{ steamId: string; name?: string }> = [];
  const seen1 = new Set<string>();
  const seen2 = new Set<string>();

  let team1Name = '';
  let team2Name = '';
  let mapWinsTeam1 = 0;
  let mapWinsTeam2 = 0;

  for (const m of Object.values(maps)) {
    if (!team1Name && m?.team1?.name) team1Name = m.team1.name;
    if (!team2Name && m?.team2?.name) team2Name = m.team2.name;

    const s1 = typeof m?.team1?.score === 'number' ? m!.team1!.score! : null;
    const s2 = typeof m?.team2?.score === 'number' ? m!.team2!.score! : null;
    if (typeof s1 === 'number' && typeof s2 === 'number') {
      if (s1 > s2) mapWinsTeam1 += 1;
      else if (s2 > s1) mapWinsTeam2 += 1;
    }

    for (const p of m?.team1?.players || []) {
      const id = String(p?.steam_id || '').trim();
      if (!id || seen1.has(id)) continue;
      seen1.add(id);
      team1Players.push({ steamId: id, name: p?.name });
    }
    for (const p of m?.team2?.players || []) {
      const id = String(p?.steam_id || '').trim();
      if (!id || seen2.has(id)) continue;
      seen2.add(id);
      team2Players.push({ steamId: id, name: p?.name });
    }
  }

  return {
    team1Name: team1Name || 'Team 1',
    team2Name: team2Name || 'Team 2',
    team1Players,
    team2Players,
    mapWinsTeam1,
    mapWinsTeam2,
  };
}

export function deriveTeamsForDate(sonmacByDate: SonmacByDate, date: string): {
  team1Name: string;
  team2Name: string;
  team1Players: Array<{ steamId: string; name?: string }>;
  team2Players: Array<{ steamId: string; name?: string }>;
  mapWinsTeam1: number;
  mapWinsTeam2: number;
} | null {
  const night = date ? sonmacByDate?.[date] : null;
  const maps = night?.maps;
  if (!maps) return null;

  const team1Players: Array<{ steamId: string; name?: string }> = [];
  const team2Players: Array<{ steamId: string; name?: string }> = [];
  const seen1 = new Set<string>();
  const seen2 = new Set<string>();

  let team1Name = '';
  let team2Name = '';
  let mapWinsTeam1 = 0;
  let mapWinsTeam2 = 0;

  for (const m of Object.values(maps)) {
    if (!team1Name && m?.team1?.name) team1Name = m.team1.name;
    if (!team2Name && m?.team2?.name) team2Name = m.team2.name;

    const s1 = typeof m?.team1?.score === 'number' ? m!.team1!.score! : null;
    const s2 = typeof m?.team2?.score === 'number' ? m!.team2!.score! : null;
    if (typeof s1 === 'number' && typeof s2 === 'number') {
      if (s1 > s2) mapWinsTeam1 += 1;
      else if (s2 > s1) mapWinsTeam2 += 1;
    }

    for (const p of m?.team1?.players || []) {
      const id = String(p?.steam_id || '').trim();
      if (!id || seen1.has(id)) continue;
      seen1.add(id);
      team1Players.push({ steamId: id, name: p?.name });
    }
    for (const p of m?.team2?.players || []) {
      const id = String(p?.steam_id || '').trim();
      if (!id || seen2.has(id)) continue;
      seen2.add(id);
      team2Players.push({ steamId: id, name: p?.name });
    }
  }

  return {
    team1Name: team1Name || 'Team 1',
    team2Name: team2Name || 'Team 2',
    team1Players,
    team2Players,
    mapWinsTeam1,
    mapWinsTeam2,
  };
}

export function winRateFromSeries(mapWinsFor: number, mapWinsAgainst: number, pointsMap: AllStarsConfig['scoring']['seriesPoints']): number | null {
  // Normalizes a "night" into one of the 5 buckets. If we can't infer, return null.
  if (mapWinsFor === 0 && mapWinsAgainst === 0) return null;
  if (mapWinsFor === mapWinsAgainst) return pointsMap['1-1D'];

  const won = mapWinsFor > mapWinsAgainst;
  const a = Math.max(mapWinsFor, mapWinsAgainst);
  const b = Math.min(mapWinsFor, mapWinsAgainst);

  // Treat any 2-0+ as 2-0, any 2-1+ as 2-1.
  const isTwoZero = a >= 2 && b === 0;
  const isTwoOne = a >= 2 && b >= 1;

  if (won) {
    if (isTwoZero) return pointsMap['2-0W'];
    if (isTwoOne) return pointsMap['2-1W'];
    return pointsMap['2-1W'];
  }

  if (isTwoZero) return pointsMap['2-0L'];
  if (isTwoOne) return pointsMap['2-1L'];
  return pointsMap['2-1L'];
}

export function getNightStatValue(row: NightAvgRow | undefined, statKey: string): number | null {
  if (!row) return null;
  const direct = row?.[statKey];
  const n = typeof direct === 'number' ? direct : Number(direct);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function computeCaptainTokens(captains: CaptainsByDateSnapshot | null | undefined, datesIncluded: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!captains) return out;
  for (const [date, rec] of Object.entries(captains)) {
    if (!datesIncluded.has(date)) continue;
    for (const teamKey of ['team1', 'team2'] as const) {
      const c = rec?.[teamKey];
      const id = c?.steamId;
      if (!id) continue;
      out[id] = (out[id] || 0) + 1;
    }
  }
  return out;
}

export function computeStandings(params: {
  config: AllStarsConfig;
  nightAvg: NightAvgData;
  sonmacByDate: SonmacByDate;
  captainsByDate: CaptainsByDateSnapshot | null;
  seasonStart: string | null;
  playersIndex: PlayersIndex;
  excludeLastNight?: boolean; // if true, exclude the most recent night for position comparison
  upToNight?: number; // if provided, only include nights up to this index (1-based)
}): {
  byLeague: Record<string, { id: string; name: string; standings: PlayerStanding[] }>;
  datesIncluded: string[];
  warnings: string[];
} {
  const { config, nightAvg, sonmacByDate, captainsByDate, seasonStart, playersIndex, excludeLastNight, upToNight } = params;

  // All-Stars nights are inferred from captain tagging: if captains were assigned for a date
  // (both teams) and the date is within the season, it counts as an All-Stars night.
  const start = seasonStart || null;
  const captainDates = Object.keys(captainsByDate || {});
  let datesIncluded = captainDates
    .filter((d) => {
      if (start && d < start) return false;
      const rec = captainsByDate?.[d];
      const t1 = rec?.team1?.steamId;
      const t2 = rec?.team2?.steamId;
      if (!t1 || !t2) return false;
      // Only include if we have nightly stats for that date
      if (!nightAvg?.[d]) return false;
      return true;
    })
    .sort();

  // If excludeLastNight is true, remove the most recent date
  if (excludeLastNight && datesIncluded.length > 0) {
    datesIncluded = datesIncluded.slice(0, -1);
  }

  // If upToNight is provided, only include nights up to that index (1-based)
  if (upToNight !== undefined && upToNight > 0) {
    datesIncluded = datesIncluded.slice(0, upToNight);
  }

  const datesIncludedSet = new Set<string>(datesIncluded);

  const captainTokensBySteamId = computeCaptainTokens(captainsByDate, datesIncludedSet);

  const nightRowIndexByDate: Record<string, Map<string, NightAvgRow>> = {};
  for (const d of datesIncluded) {
    const rows = nightAvg?.[d] || [];
    const map = new Map<string, NightAvgRow>();
    for (const r of rows) {
      if (r?.steam_id) map.set(r.steam_id, r);
    }
    nightRowIndexByDate[d] = map;
  }

  const warnings: string[] = [];

  function perNightPointsForPlayer(steamId: string): Array<{ date: string; hltv2: number; bonus: number; points: number }> {
    const results: Array<{ date: string; hltv2: number; bonus: number; points: number }> = [];
    for (const d of datesIncluded) {
      // Use main league teams only (excludes casual third matches)
      const teams = deriveMainLeagueTeamsForDate(sonmacByDate, d);
      if (!teams) continue;

      const isOnTeam1 = teams.team1Players.some((p) => p.steamId === steamId);
      const isOnTeam2 = teams.team2Players.some((p) => p.steamId === steamId);
      if (!isOnTeam1 && !isOnTeam2) continue;

      const nightRow = nightRowIndexByDate[d].get(steamId);
      const hltv2 = getNightStatValue(nightRow, config.scoring.useStat);
      if (hltv2 === null) continue;

      const winRate = isOnTeam1
        ? winRateFromSeries(teams.mapWinsTeam1, teams.mapWinsTeam2, config.scoring.seriesPoints)
        : winRateFromSeries(teams.mapWinsTeam2, teams.mapWinsTeam1, config.scoring.seriesPoints);

      if (winRate === null) {
        // If we can't infer a series result, skip scoring for this date.
        continue;
      }

      results.push({ date: d, hltv2, bonus: winRate, points: hltv2 + winRate });
    }
    return results;
  }

  function average(nums: number[]): number {
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  const byLeague: Record<string, { id: string; name: string; standings: PlayerStanding[] }> = {};

  for (const league of config.leagues || []) {
    const standings: PlayerStanding[] = [];

    for (const steamId of league.players || []) {
      const displayName = displayNameForSteamId(steamId, playersIndex);

      const nights = perNightPointsForPlayer(steamId);
      const oyn = nights.length;
      const kpt = captainTokensBySteamId[steamId] || 0;

      const points = nights.map((n) => n.points);
      const puanRaw = average(points);

      const dropCount = Math.min(kpt, Math.max(0, oyn - 1));

      // Decide which nights are dropped: sort by lowest points, then earliest date.
      const sortedByWorst = [...nights].sort((a, b) => {
        if (a.points !== b.points) return a.points - b.points;
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      });
      const droppedDates = new Set(sortedByWorst.slice(0, dropCount).map((n) => n.date));
      const keptPoints = nights.filter((n) => !droppedDates.has(n.date)).map((n) => n.points);
      const puanAdj = average(keptPoints);

      const nightBreakdown = nights
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((n) => ({ date: n.date, hltv2: n.hltv2, bonus: n.bonus, points: n.points, dropped: droppedDates.has(n.date) }));

      // Player meets criteria if they have 5+ matches and 1+ captaincy
      const meetsKriteria = oyn >= 5 && kpt >= 1;

      standings.push({
        steamId,
        name: displayName,
        oyn,
        kpt,
        puanRaw,
        puanAdj,
        nightBreakdown,
        meetsKriteria,
      });
    }

    standings.sort((a, b) => b.puanAdj - a.puanAdj);
    byLeague[league.id] = { id: league.id, name: league.name, standings };
  }

    if (!datesIncluded.length) {
      warnings.push('Henüz All-Stars gecesi yok (sezon içinde bir gece için iki takım kaptanını da girin).');
    }

  return { byLeague, datesIncluded, warnings };
}

/**
 * Token Wars – scoring & standings logic.
 *
 * Scoring per night:
 *   nightPoints = Performance Points (from HLTV2 DIFF bracket) + Team Points (from series result)
 *
 * Token types (each captain token can be used as ONE of these):
 *   - delete_worst:  Remove your own worst night
 *   - lock_best:     Lock an opponent's best night (same league only)
 *   - protect_best:  Protect your own best night from being locked
 *   - unlock:        Unlock a night that someone else locked
 */

import type {
  NightAvgData,
  NightAvgRow,
  SonmacByDate,
  CaptainsByDateSnapshot,
  PlayersIndex,
} from './batakAllStars';

import {
  buildPlayersIndex,
  displayNameForSteamId,
  deriveTeamsForDate,
  deriveMainLeagueTeamsForDate,
  getNightStatValue,
  computeCaptainTokens,
} from './batakAllStars';

// Re-export shared helpers so pages can import from one place
export { buildPlayersIndex, displayNameForSteamId, deriveTeamsForDate, deriveMainLeagueTeamsForDate, getNightStatValue, computeCaptainTokens };

// ── Config types ──────────────────────────────────────────────────────────────

export type PerformanceBracket = { min: number; max: number; points: number };

export type TokenWarsConfig = {
  version: number;
  scoring: {
    useStat: string; // "HLTV2 DIFF"
    performancePoints: PerformanceBracket[];
    teamPoints: {
      '2-0W': number;
      '2-1W': number;
      '1-1D': number;
      '1-2L': number;
      '0-2L': number;
    };
    tokenTypes: string[];
  };
  notes?: Record<string, string>;
  leagues: Array<{
    id: string;
    name: string;
    players: string[];
  }>;
};

// ── Token action types ────────────────────────────────────────────────────────

export type TokenAction = {
  id?: string;
  date: string;           // night this token applies to
  actorSteamId: string;   // who used the token
  targetSteamId: string;  // who it targets (self for delete_worst / protect_best)
  tokenType: 'delete_worst' | 'lock_best' | 'protect_best' | 'unlock';
  setByUid?: string;
  setByName?: string;
  setAt?: number;
};

export type TokensByDateSnapshot = Record<string, TokenAction[]>;

// ── Standing types ────────────────────────────────────────────────────────────

export type NightBreakdownEntry = {
  date: string;
  hltv2Diff: number;
  perfPoints: number;
  teamPoints: number;
  totalPoints: number;
  deleted: boolean;   // removed by delete_worst token
  locked: boolean;    // locked by opponent's lock_best token
  protected: boolean; // protected by protect_best token
  unlocked: boolean;  // was locked but then unlocked
};

export type TokenWarsPlayerStanding = {
  steamId: string;
  name: string;
  oyn: number;          // nights played
  kpt: number;          // captain tokens earned
  tokensUsed: number;   // tokens already spent
  totalPoints: number;  // sum of effective night points
  nightBreakdown: NightBreakdownEntry[];
  meetsKriteria: boolean;
  positionChange?: 'up' | 'down' | 'same' | 'new';
};

// ── Scoring helpers ───────────────────────────────────────────────────────────

export function performancePointsFromDiff(
  diff: number,
  brackets: PerformanceBracket[],
): number {
  for (const b of brackets) {
    if (diff >= b.min && diff <= b.max) return b.points;
  }
  return 0;
}

function seriesResultKey(mapWinsFor: number, mapWinsAgainst: number): string | null {
  if (mapWinsFor === 0 && mapWinsAgainst === 0) return null;
  if (mapWinsFor === mapWinsAgainst) return '1-1D';
  const won = mapWinsFor > mapWinsAgainst;
  const a = Math.max(mapWinsFor, mapWinsAgainst);
  const b = Math.min(mapWinsFor, mapWinsAgainst);
  const isTwoZero = a >= 2 && b === 0;
  if (won) return isTwoZero ? '2-0W' : '2-1W';
  return isTwoZero ? '0-2L' : '1-2L';
}

export function teamPointsFromSeries(
  mapWinsFor: number,
  mapWinsAgainst: number,
  pointsMap: TokenWarsConfig['scoring']['teamPoints'],
): number | null {
  const key = seriesResultKey(mapWinsFor, mapWinsAgainst);
  if (!key) return null;
  return (pointsMap as Record<string, number>)[key] ?? null;
}

// ── Token resolution ──────────────────────────────────────────────────────────

/**
 * Given all tokens, resolves the effective state for each (player, date) pair:
 *  - deleted: player used delete_worst on this night
 *  - locked:  opponent used lock_best on this night for this player
 *  - protected: player used protect_best on this night
 *  - unlocked: someone used unlock to reverse a lock on this night
 */
export function resolveTokenEffects(
  tokens: TokensByDateSnapshot | null,
): {
  deletedNights: Map<string, Set<string>>;   // steamId → set of deleted dates
  lockedNights: Map<string, Set<string>>;    // steamId → set of locked dates
  protectedNights: Map<string, Set<string>>; // steamId → set of protected dates
  unlockedNights: Map<string, Set<string>>;  // steamId → set of unlocked dates
} {
  const deletedNights = new Map<string, Set<string>>();
  const lockedNights = new Map<string, Set<string>>();
  const protectedNights = new Map<string, Set<string>>();
  const unlockedNights = new Map<string, Set<string>>();

  if (!tokens) return { deletedNights, lockedNights, protectedNights, unlockedNights };

  function addToMap(map: Map<string, Set<string>>, steamId: string, date: string) {
    if (!map.has(steamId)) map.set(steamId, new Set());
    map.get(steamId)!.add(date);
  }

  // Process all token actions
  for (const actions of Object.values(tokens)) {
    for (const t of actions) {
      switch (t.tokenType) {
        case 'delete_worst':
          addToMap(deletedNights, t.actorSteamId, t.date);
          break;
        case 'lock_best':
          addToMap(lockedNights, t.targetSteamId, t.date);
          break;
        case 'protect_best':
          addToMap(protectedNights, t.actorSteamId, t.date);
          break;
        case 'unlock':
          addToMap(unlockedNights, t.targetSteamId, t.date);
          break;
      }
    }
  }

  return { deletedNights, lockedNights, protectedNights, unlockedNights };
}

// ── Main standings computation ────────────────────────────────────────────────

export function computeTokenWarsStandings(params: {
  config: TokenWarsConfig;
  nightAvg: NightAvgData;
  sonmacByDate: SonmacByDate;
  captainsByDate: CaptainsByDateSnapshot | null;
  tokensByDate: TokensByDateSnapshot | null;
  seasonStart: string | null;
  playersIndex: PlayersIndex;
  upToNight?: number;
}): {
  byLeague: Record<string, { id: string; name: string; standings: TokenWarsPlayerStanding[] }>;
  datesIncluded: string[];
  warnings: string[];
} {
  const { config, nightAvg, sonmacByDate, captainsByDate, tokensByDate, seasonStart, playersIndex, upToNight } = params;

  const start = seasonStart || null;
  const captainDates = Object.keys(captainsByDate || {});
  let datesIncluded = captainDates
    .filter((d) => {
      if (start && d < start) return false;
      const rec = captainsByDate?.[d];
      if (!rec?.team1?.steamId || !rec?.team2?.steamId) return false;
      if (!nightAvg?.[d]) return false;
      return true;
    })
    .sort();

  if (upToNight !== undefined && upToNight > 0) {
    datesIncluded = datesIncluded.slice(0, upToNight);
  }

  const datesIncludedSet = new Set(datesIncluded);
  const captainTokensBySteamId = computeCaptainTokens(captainsByDate, datesIncludedSet);
  const scopedTokensByDate: TokensByDateSnapshot | null = tokensByDate
    ? Object.fromEntries(Object.entries(tokensByDate).filter(([date]) => datesIncludedSet.has(date)))
    : null;

  // Resolve token effects
  const { deletedNights, lockedNights, protectedNights, unlockedNights } = resolveTokenEffects(scopedTokensByDate);

  // Count tokens used per player
  const tokensUsedBySteamId: Record<string, number> = {};
  if (scopedTokensByDate) {
    for (const actions of Object.values(scopedTokensByDate)) {
      for (const t of actions) {
        tokensUsedBySteamId[t.actorSteamId] = (tokensUsedBySteamId[t.actorSteamId] || 0) + 1;
      }
    }
  }

  // Build night stat lookup
  const nightRowIndex: Record<string, Map<string, NightAvgRow>> = {};
  for (const d of datesIncluded) {
    const rows = nightAvg?.[d] || [];
    const map = new Map<string, NightAvgRow>();
    for (const r of rows) {
      if (r?.steam_id) map.set(r.steam_id, r);
    }
    nightRowIndex[d] = map;
  }

  const warnings: string[] = [];

  function nightBreakdownForPlayer(steamId: string): NightBreakdownEntry[] {
    const results: NightBreakdownEntry[] = [];

    for (const d of datesIncluded) {
      // Use main-league teams (ignoring casual 3rd maps) for scoring, consistent with All-Stars
      const teams = deriveMainLeagueTeamsForDate(sonmacByDate, d);
      if (!teams) continue;

      const isTeam1 = teams.team1Players.some((p) => p.steamId === steamId);
      const isTeam2 = teams.team2Players.some((p) => p.steamId === steamId);
      if (!isTeam1 && !isTeam2) continue;

      const nightRow = nightRowIndex[d]?.get(steamId);
      const hltv2Diff = getNightStatValue(nightRow, config.scoring.useStat);
      if (hltv2Diff === null) continue;

      const perfPoints = performancePointsFromDiff(hltv2Diff, config.scoring.performancePoints);

      const tp = isTeam1
        ? teamPointsFromSeries(teams.mapWinsTeam1, teams.mapWinsTeam2, config.scoring.teamPoints)
        : teamPointsFromSeries(teams.mapWinsTeam2, teams.mapWinsTeam1, config.scoring.teamPoints);
      if (tp === null) continue;

      // Token effects for this player on this date
      const isDeleted = deletedNights.get(steamId)?.has(d) ?? false;
      const isProtected = protectedNights.get(steamId)?.has(d) ?? false;
      const isUnlocked = unlockedNights.get(steamId)?.has(d) ?? false;
      // A night is effectively locked only if locked AND not protected AND not unlocked
      const rawLocked = lockedNights.get(steamId)?.has(d) ?? false;
      const isLocked = rawLocked && !isProtected && !isUnlocked;

      results.push({
        date: d,
        hltv2Diff,
        perfPoints,
        teamPoints: tp,
        totalPoints: perfPoints + tp,
        deleted: isDeleted,
        locked: isLocked,
        protected: isProtected,
        unlocked: isUnlocked && rawLocked,
      });
    }

    return results.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const byLeague: Record<string, { id: string; name: string; standings: TokenWarsPlayerStanding[] }> = {};

  for (const league of config.leagues || []) {
    const standings: TokenWarsPlayerStanding[] = [];

    for (const steamId of league.players || []) {
      const name = displayNameForSteamId(steamId, playersIndex);
      const breakdown = nightBreakdownForPlayer(steamId);
      const oyn = breakdown.length;
      const kpt = captainTokensBySteamId[steamId] || 0;
      const tokensUsed = tokensUsedBySteamId[steamId] || 0;

      // Calculate total: sum of effective (not deleted, not locked) night points
      const effectiveNights = breakdown.filter((n) => !n.deleted && !n.locked);
      const totalPoints = effectiveNights.reduce((sum, n) => sum + n.totalPoints, 0);

      const meetsKriteria = oyn >= 5 && kpt >= 1;

      standings.push({
        steamId,
        name,
        oyn,
        kpt,
        tokensUsed,
        totalPoints,
        nightBreakdown: breakdown,
        meetsKriteria,
      });
    }

    standings.sort((a, b) => b.totalPoints - a.totalPoints);
    byLeague[league.id] = { id: league.id, name: league.name, standings };
  }

  if (!datesIncluded.length) {
    warnings.push('Henüz Token Wars gecesi yok (sezon içinde bir gece için iki takım kaptanını da girin).');
  }

  return { byLeague, datesIncluded, warnings };
}

/**
 * Returns what tokens a player can still use.
 * Each captain token gives 1 token use. Already-used tokens are subtracted.
 */
export function availableTokens(
  steamId: string,
  captainTokens: number,
  tokensByDate: TokensByDateSnapshot | null,
): number {
  let used = 0;
  if (tokensByDate) {
    for (const actions of Object.values(tokensByDate)) {
      for (const t of actions) {
        if (t.actorSteamId === steamId) used++;
      }
    }
  }
  return Math.max(0, captainTokens - used);
}

/**
 * Returns the league ID a player belongs to, or null if not found.
 */
export function getPlayerLeague(steamId: string, config: TokenWarsConfig): string | null {
  for (const league of config.leagues) {
    if (league.players.includes(steamId)) return league.id;
  }
  return null;
}

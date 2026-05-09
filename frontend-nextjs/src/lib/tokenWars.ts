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
  id?: number;
  actorSteamId: string;   // who used the token
  targetSteamId: string;  // who it targets (self for delete_worst / protect_best)
  tokenType: 'delete_worst' | 'lock_best' | 'protect_best' | 'unlock';
  setByUid?: string;
  setByName?: string;
  setAt?: number;
};

export type TokensSnapshot = TokenAction[];

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
  totalPoints: number;  // average of effective night points
  nightBreakdown: NightBreakdownEntry[];
  meetsKriteria: boolean;
  positionChange?: 'up' | 'down' | 'same' | 'new';
};

// ── Scoring helpers ───────────────────────────────────────────────────────────

export function performancePointsFromDiff(
  diff: number,
  brackets: PerformanceBracket[],
): number {
  const roundedDiff = Number(diff.toFixed(2));

  for (const b of brackets) {
    if (b.min <= -999) {
      if (roundedDiff < b.max) return b.points;
      continue;
    }

    if (b.max >= 999) {
      if (roundedDiff >= b.min) return b.points;
      continue;
    }

    if (roundedDiff >= b.min && roundedDiff <= b.max) return b.points;
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
 * Given all tokens (without dates) and raw night breakdowns for all players,
 * dynamically resolves which night each token applies to.
 *
 * Processing order:
 *   1. protect_best  – mark actor's best nights as protected (immune to lock)
 *   2. lock_best     – mark target's best unprotected nights as locked
 *   3. unlock        – remove a lock from the target player
 *   4. delete_worst  – mark actor's worst effective nights as deleted
 *
 * Within each type, tokens are processed by setAt (earliest first).
 */
export function resolveTokenEffects(
  tokens: TokensSnapshot | null,
  rawBreakdowns: Map<string, NightBreakdownEntry[]>,
): {
  deletedNights: Map<string, Set<string>>;
  lockedNights: Map<string, Set<string>>;
  protectedNights: Map<string, Set<string>>;
  unlockedNights: Map<string, Set<string>>;
} {
  const deletedNights = new Map<string, Set<string>>();
  const lockedNights = new Map<string, Set<string>>();
  const protectedNights = new Map<string, Set<string>>();
  const unlockedNights = new Map<string, Set<string>>();

  if (!tokens || tokens.length === 0) {
    return { deletedNights, lockedNights, protectedNights, unlockedNights };
  }

  function addToMap(map: Map<string, Set<string>>, steamId: string, date: string) {
    if (!map.has(steamId)) map.set(steamId, new Set());
    map.get(steamId)!.add(date);
  }

  function isProtected(steamId: string, date: string) {
    return protectedNights.get(steamId)?.has(date) ?? false;
  }
  function isLocked(steamId: string, date: string) {
    return lockedNights.get(steamId)?.has(date) ?? false;
  }
  function isUnlocked(steamId: string, date: string) {
    return unlockedNights.get(steamId)?.has(date) ?? false;
  }
  function isDeleted(steamId: string, date: string) {
    return deletedNights.get(steamId)?.has(date) ?? false;
  }

  const bySetAt = (a: TokenAction, b: TokenAction) => (a.setAt ?? 0) - (b.setAt ?? 0);

  // 1. protect_best – actor's best unprotected nights
  const protectTokens = tokens.filter((t) => t.tokenType === 'protect_best').sort(bySetAt);
  for (const t of protectTokens) {
    const nights = rawBreakdowns.get(t.actorSteamId) || [];
    const candidate = [...nights]
      .filter((n) => !isProtected(t.actorSteamId, n.date))
      .sort((a, b) => b.totalPoints - a.totalPoints)[0];
    if (candidate) addToMap(protectedNights, t.actorSteamId, candidate.date);
  }

  // 2. lock_best – target's best unprotected, unlocked nights
  const lockTokens = tokens.filter((t) => t.tokenType === 'lock_best').sort(bySetAt);
  for (const t of lockTokens) {
    const nights = rawBreakdowns.get(t.targetSteamId) || [];
    const candidate = [...nights]
      .filter((n) => !isProtected(t.targetSteamId, n.date) && !isLocked(t.targetSteamId, n.date))
      .sort((a, b) => b.totalPoints - a.totalPoints)[0];
    if (candidate) addToMap(lockedNights, t.targetSteamId, candidate.date);
  }

  // 3. unlock – remove a lock from target's locked night (most impactful first)
  const unlockTokens = tokens.filter((t) => t.tokenType === 'unlock').sort(bySetAt);
  for (const t of unlockTokens) {
    const nights = rawBreakdowns.get(t.targetSteamId) || [];
    const candidate = [...nights]
      .filter((n) => isLocked(t.targetSteamId, n.date) && !isUnlocked(t.targetSteamId, n.date))
      .sort((a, b) => b.totalPoints - a.totalPoints)[0];
    if (candidate) addToMap(unlockedNights, t.targetSteamId, candidate.date);
  }

  // 4. delete_worst – actor's worst non-locked, non-deleted nights
  const deleteTokens = tokens.filter((t) => t.tokenType === 'delete_worst').sort(bySetAt);
  for (const t of deleteTokens) {
    const nights = rawBreakdowns.get(t.actorSteamId) || [];
    const candidate = [...nights]
      .filter((n) => {
        const effectivelyLocked = isLocked(t.actorSteamId, n.date) && !isUnlocked(t.actorSteamId, n.date);
        return !effectivelyLocked && !isDeleted(t.actorSteamId, n.date);
      })
      .sort((a, b) => a.totalPoints - b.totalPoints)[0];
    if (candidate) addToMap(deletedNights, t.actorSteamId, candidate.date);
  }

  return { deletedNights, lockedNights, protectedNights, unlockedNights };
}

// ── Main standings computation ────────────────────────────────────────────────

export function computeTokenWarsStandings(params: {
  config: TokenWarsConfig;
  nightAvg: NightAvgData;
  sonmacByDate: SonmacByDate;
  captainsByDate: CaptainsByDateSnapshot | null;
  tokens: TokensSnapshot | null;
  seasonStart: string | null;
  playersIndex: PlayersIndex;
  upToNight?: number;
}): {
  byLeague: Record<string, { id: string; name: string; standings: TokenWarsPlayerStanding[] }>;
  datesIncluded: string[];
  warnings: string[];
} {
  const { config, nightAvg, sonmacByDate, captainsByDate, tokens, seasonStart, playersIndex, upToNight } = params;

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

  // Count tokens used per player
  const tokensUsedBySteamId: Record<string, number> = {};
  if (tokens) {
    for (const t of tokens) {
      tokensUsedBySteamId[t.actorSteamId] = (tokensUsedBySteamId[t.actorSteamId] || 0) + 1;
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

  // Step 1: compute raw night breakdowns (no token effects) for all players
  function rawNightBreakdownForPlayer(steamId: string): NightBreakdownEntry[] {
    const results: NightBreakdownEntry[] = [];

    for (const d of datesIncluded) {
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

      results.push({
        date: d,
        hltv2Diff,
        perfPoints,
        teamPoints: tp,
        totalPoints: perfPoints + tp,
        deleted: false,
        locked: false,
        protected: false,
        unlocked: false,
      });
    }

    return results.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // Collect all players and their raw breakdowns
  const allPlayerSteamIds: string[] = [];
  const rawBreakdowns = new Map<string, NightBreakdownEntry[]>();
  for (const league of config.leagues || []) {
    for (const steamId of league.players || []) {
      allPlayerSteamIds.push(steamId);
      rawBreakdowns.set(steamId, rawNightBreakdownForPlayer(steamId));
    }
  }

  // Step 2: resolve token effects dynamically against the raw breakdowns
  const { deletedNights, lockedNights, protectedNights, unlockedNights } = resolveTokenEffects(tokens, rawBreakdowns);

  // Step 3: apply resolved effects back to build final breakdowns
  function applyTokenEffects(steamId: string, raw: NightBreakdownEntry[]): NightBreakdownEntry[] {
    return raw.map((entry) => {
      const isDeleted = deletedNights.get(steamId)?.has(entry.date) ?? false;
      const isProtected = protectedNights.get(steamId)?.has(entry.date) ?? false;
      const isUnlockedFlag = unlockedNights.get(steamId)?.has(entry.date) ?? false;
      const rawLocked = lockedNights.get(steamId)?.has(entry.date) ?? false;
      const isLocked = rawLocked && !isProtected && !isUnlockedFlag;

      return {
        ...entry,
        deleted: isDeleted,
        locked: isLocked,
        protected: isProtected,
        unlocked: isUnlockedFlag && rawLocked,
      };
    });
  }

  const byLeague: Record<string, { id: string; name: string; standings: TokenWarsPlayerStanding[] }> = {};

  for (const league of config.leagues || []) {
    const standings: TokenWarsPlayerStanding[] = [];

    for (const steamId of league.players || []) {
      const name = displayNameForSteamId(steamId, playersIndex);
      const raw = rawBreakdowns.get(steamId) || [];
      const breakdown = applyTokenEffects(steamId, raw);
      const oyn = breakdown.length;
      const kpt = captainTokensBySteamId[steamId] || 0;
      const tokensUsed = tokensUsedBySteamId[steamId] || 0;

      // Calculate average of effective (not deleted, not locked) night points
      const effectiveNights = breakdown.filter((n) => !n.deleted && !n.locked);
      const totalPoints = effectiveNights.length > 0
        ? effectiveNights.reduce((sum, n) => sum + n.totalPoints, 0) / effectiveNights.length
        : 0;

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
  tokens: TokensSnapshot | null,
): number {
  let used = 0;
  if (tokens) {
    for (const t of tokens) {
      if (t.actorSteamId === steamId) used++;
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

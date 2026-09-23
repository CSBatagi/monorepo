// Team balance model used by the team picker to suggest (never apply) swaps.
//
// Every constant below was chosen by backtesting against the club's match history
// (Feb 2025 onward, ~220 maps) using only data available before each night. The
// reasoning and the numbers behind it live in docs/features/team-balancer.md.
//
// Summary of the formula:
//   base rating  = (sum of HLTV 2.0 over the player's last 150 maps + 10 × prior) / (maps + 10)
//   map rating   = (sum of HLTV 2.0 on that map + 8 × base) / (maps on that map + 8)
//   team power   = mean(player ratings) + 0.2 × best player rating
//   P(A wins)    = 1 / (1 + e^(−4.5 × (power A − power B)))

export interface PlayerRatingMapTotals {
  maps: number;
  hltv_2_sum: number;
}

/** One entry of the backend `player_ratings` dataset. */
export interface PlayerRatingEntry {
  steam_id: string;
  name: string;
  maps: number;
  hltv_2_sum: number;
  by_map: Record<string, PlayerRatingMapTotals>;
}

export const BALANCE_MODEL = {
  /** Assumed HLTV 2.0 for a player with no history. New players averaged ~0.8 in their first 10 maps. */
  newcomerPrior: 0.9,
  /** Pseudo-maps of prior blended into a player's long-run average. */
  priorMaps: 10,
  /** Pseudo-maps of the player's own base rating blended into their map-specific average. */
  mapPriorMaps: 8,
  /** Extra weight on each team's best player; carries swung rounds more than the weakest slot. */
  starWeight: 0.2,
  /** Logistic slope turning a power gap into a map win probability. */
  winSlope: 4.5,
  /** Below this gap the favourite won 47% of maps: a coin flip. */
  balancedGap: 0.05,
  /** From here the favourite won 74% of maps (51% between 0.05 and 0.10), so only here are swaps suggested. */
  unbalancedGap: 0.1,
  /** A suggestion must shrink the gap by at least this much to be shown. */
  minImprovement: 0.01,
  /** Penalty (in gap units) per extra player pair moved, so single swaps win ties. */
  extraMovePenalty: 0.02,
  maxSuggestions: 3,
} as const;

// Workshop maps show up in the picker as numeric ids with a display name, while
// match history stores the in-game map name (de_cbble_d, de_tuscan_d, ...).
// Both are reduced to the same key so their histories line up.
const MAP_KEY_ALIASES: Record<string, string> = {
  cbble: 'cobble',
  dustii: 'dust2',
};

export function normalizeMapKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/^(de|cs|ar)_/, '')
    .replace(/_d$/, '')
    .replace(/[^a-z0-9]/g, '');
  return MAP_KEY_ALIASES[key] ?? key;
}

interface IndexedRating {
  maps: number;
  sum: number;
  byMap: Map<string, { maps: number; sum: number }>;
}

export type RatingIndex = Map<string, IndexedRating>;

export function indexPlayerRatings(entries: PlayerRatingEntry[] | null | undefined): RatingIndex {
  const index: RatingIndex = new Map();
  if (!Array.isArray(entries)) return index;
  for (const entry of entries) {
    if (!entry?.steam_id) continue;
    const byMap = new Map<string, { maps: number; sum: number }>();
    for (const [mapName, totals] of Object.entries(entry.by_map || {})) {
      const key = normalizeMapKey(mapName);
      const prev = byMap.get(key) || { maps: 0, sum: 0 };
      byMap.set(key, { maps: prev.maps + (Number(totals?.maps) || 0), sum: prev.sum + (Number(totals?.hltv_2_sum) || 0) });
    }
    index.set(entry.steam_id, { maps: Number(entry.maps) || 0, sum: Number(entry.hltv_2_sum) || 0, byMap });
  }
  return index;
}

export interface PlayerBalanceRating {
  rating: number;
  /** Maps behind the long-run rating (0 = newcomer, rating is the prior). */
  maps: number;
  /** Maps played on the selected maps (0 when no map is selected). */
  mapMaps: number;
}

/**
 * Rating for one player. `mapKeys` are normalized keys of the selected maps; with
 * several maps the map-specific ratings are averaged. `prior` replaces the newcomer
 * prior (e.g. a manual stat override for a player with no history).
 */
export function playerBalanceRating(
  index: RatingIndex,
  steamId: string,
  mapKeys: string[] = [],
  prior: number = BALANCE_MODEL.newcomerPrior,
): PlayerBalanceRating {
  const { priorMaps, mapPriorMaps } = BALANCE_MODEL;
  const entry = index.get(steamId);
  const maps = entry?.maps ?? 0;
  const base = ((entry?.sum ?? 0) + priorMaps * prior) / (maps + priorMaps);
  if (!mapKeys.length) return { rating: base, maps, mapMaps: 0 };
  let total = 0;
  let mapMaps = 0;
  for (const key of mapKeys) {
    const onMap = entry?.byMap.get(key);
    mapMaps += onMap?.maps ?? 0;
    total += ((onMap?.sum ?? 0) + mapPriorMaps * base) / ((onMap?.maps ?? 0) + mapPriorMaps);
  }
  return { rating: total / mapKeys.length, maps, mapMaps };
}

export function teamPower(ratings: number[]): number | null {
  if (!ratings.length) return null;
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return mean + BALANCE_MODEL.starWeight * Math.max(...ratings);
}

export function winProbability(gap: number): number {
  return 1 / (1 + Math.exp(-BALANCE_MODEL.winSlope * gap));
}

export type BalanceVerdict = 'balanced' | 'slight' | 'unbalanced';

export function balanceVerdict(gap: number): BalanceVerdict {
  const abs = Math.abs(gap);
  if (abs < BALANCE_MODEL.balancedGap) return 'balanced';
  if (abs < BALANCE_MODEL.unbalancedGap) return 'slight';
  return 'unbalanced';
}

export interface BalancePlayer {
  steamId: string;
  name: string;
  rating: number;
}

export interface BalanceSuggestion {
  /** Players that would move from Team A to Team B. */
  toB: BalancePlayer[];
  /** Players that would move from Team B to Team A. */
  toA: BalancePlayer[];
  powerA: number;
  powerB: number;
  gap: number;
  probA: number;
}

export interface BalanceReport {
  powerA: number;
  powerB: number;
  /** powerA − powerB */
  gap: number;
  probA: number;
  verdict: BalanceVerdict;
  suggestions: BalanceSuggestion[];
}

function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
  }
  return out;
}

/**
 * Scores the current teams and lists the smallest roster changes that bring them
 * closer. Pure: the caller decides whether to show or apply anything.
 */
export function analyzeBalance(teamA: BalancePlayer[], teamB: BalancePlayer[]): BalanceReport | null {
  const powerA = teamPower(teamA.map((p) => p.rating));
  const powerB = teamPower(teamB.map((p) => p.rating));
  if (powerA === null || powerB === null) return null;
  const gap = powerA - powerB;
  const report: BalanceReport = { powerA, powerB, gap, probA: winProbability(gap), verdict: balanceVerdict(gap), suggestions: [] };
  if (report.verdict !== 'unbalanced') return report;

  const candidates: { suggestion: BalanceSuggestion; score: number }[] = [];
  const consider = (toB: BalancePlayer[], toA: BalancePlayer[]) => {
    const leaving = new Set([...toB, ...toA].map((p) => p.steamId));
    const nextA = [...teamA.filter((p) => !leaving.has(p.steamId)), ...toA];
    const nextB = [...teamB.filter((p) => !leaving.has(p.steamId)), ...toB];
    const nextPowerA = teamPower(nextA.map((p) => p.rating));
    const nextPowerB = teamPower(nextB.map((p) => p.rating));
    if (nextPowerA === null || nextPowerB === null) return;
    const nextGap = nextPowerA - nextPowerB;
    if (Math.abs(gap) - Math.abs(nextGap) < BALANCE_MODEL.minImprovement) return;
    const extraPairs = Math.max(toB.length, toA.length) - 1;
    candidates.push({
      suggestion: { toB, toA, powerA: nextPowerA, powerB: nextPowerB, gap: nextGap, probA: winProbability(nextGap) },
      score: Math.abs(nextGap) + extraPairs * BALANCE_MODEL.extraMovePenalty,
    });
  };

  const sizeDiff = teamA.length - teamB.length;
  if (Math.abs(sizeDiff) >= 2) {
    // Uneven rosters: moving one player from the bigger side fixes size and balance together.
    if (sizeDiff > 0) teamA.forEach((p) => consider([p], []));
    else teamB.forEach((p) => consider([], [p]));
  }
  for (const a of teamA) for (const b of teamB) consider([a], [b]);
  const pairsA = pairs(teamA);
  const pairsB = pairs(teamB);
  for (const a of pairsA) for (const b of pairsB) consider(a, b);

  candidates.sort((x, y) => x.score - y.score);
  const picked = candidates.slice(0, BALANCE_MODEL.maxSuggestions);
  // Always offer the simplest fix: if only double swaps made the cut, swap the last
  // one for the best single-player change.
  const isSingle = (c: (typeof candidates)[number]) => c.suggestion.toA.length <= 1 && c.suggestion.toB.length <= 1;
  const bestSingle = candidates.find(isSingle);
  if (bestSingle && !picked.some(isSingle)) picked[picked.length - 1] = bestSingle;
  report.suggestions = picked.sort((x, y) => x.score - y.score).map((c) => c.suggestion);
  return report;
}

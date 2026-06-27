/**
 * Superliga – puan bazlı tek liste dizilim.
 *
 * Token sistemi yok, saldırı/savunma/koruma yok, HLTV faktörü yok.
 * Puanlama tamamen maç sonuçlarından (sonmac_by_date) hesaplanır.
 *
 * Harita bazlı puanlama:
 *   - Kazanan takımın her oyuncusu: 15 puan + averaj (skor farkı)
 *   - Uzatmaya giden haritalarda KAYBEDEN takım: her uzatma serisi için +5
 *     teselli puanı (en fazla 3 seri = 15 puan).
 *   - Kaptanlar, kaptanlık yaptıkları her gece için +5 ekstra puan alır.
 *
 * Toplam puan kümülatiftir (ortalama değil): oyuncular kazandıkça yukarı tırmanır.
 */

import type {
  SonmacByDate,
  CaptainsByDateSnapshot,
  PlayersIndex,
} from './batakAllStars';

import {
  buildPlayersIndex,
  displayNameForSteamId,
  deriveTeamsForDate,
  getMainLeagueMapsForDate,
} from './batakAllStars';

// Re-export shared helpers so pages can import from one place
export { buildPlayersIndex, displayNameForSteamId, deriveTeamsForDate, getMainLeagueMapsForDate };

// ── Config types ──────────────────────────────────────────────────────────────

export type SuperligaConfig = {
  version: number;
  seasonStart?: string;
  seasonLength?: number;
  scoring: {
    winPoints: number;
    captainBonus: number;
    overtimeConsolationPerSeries: number;
    maxOvertimeConsolationSeries: number;
    regulationRounds: number;
    roundsPerOvertime: number;
  };
  notes?: Record<string, string>;
  leagues: Array<{
    id: string;
    name: string;
    players: string[];
  }>;
};

export const DEFAULT_SUPERLIGA_SCORING: SuperligaConfig['scoring'] = {
  winPoints: 15,
  captainBonus: 5,
  overtimeConsolationPerSeries: 5,
  maxOvertimeConsolationSeries: 3,
  regulationRounds: 24,
  roundsPerOvertime: 6,
};

// ── Standing types ──────────────────────────────────────────────────────────────

export type SuperligaMapResult = {
  mapName: string;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  averaj: number;       // skor farkı (mutlak)
  overtimes: number;    // uzatma serisi sayısı
  points: number;       // bu haritadan kazanılan puan
};

export type SuperligaNightEntry = {
  date: string;
  isCaptain: boolean;
  captainBonus: number;
  mapPoints: number;     // haritalardan toplanan puan
  points: number;        // mapPoints + captainBonus
  maps: SuperligaMapResult[];
};

export type SuperligaPlayerStanding = {
  steamId: string;
  name: string;
  nightsPlayed: number;
  mapsPlayed: number;
  mapsWon: number;
  captainNights: number;
  totalPoints: number;     // tüm gecelerin toplam puanı (referans için)
  avgPoints: number;       // gece başına ortalama puan (sıralama bu puana göre)
  nightBreakdown: SuperligaNightEntry[];
  positionChange?: 'up' | 'down' | 'same' | 'new';
};

// ── Scoring helpers ──────────────────────────────────────────────────────────────

/**
 * Bir haritanın skorundan, verilen takım perspektifiyle puanı hesaplar.
 * Kazanan: winPoints + averaj. Kaybeden: (uzatma varsa) teselli puanı, yoksa 0.
 */
export function computeMapPoints(
  scoreFor: number,
  scoreAgainst: number,
  scoring: SuperligaConfig['scoring'],
): { won: boolean; averaj: number; overtimes: number; points: number } | null {
  if (!Number.isFinite(scoreFor) || !Number.isFinite(scoreAgainst)) return null;
  if (scoreFor === scoreAgainst) return null; // berabere harita olmaz

  const won = scoreFor > scoreAgainst;
  const averaj = Math.abs(scoreFor - scoreAgainst);
  const totalRounds = scoreFor + scoreAgainst;

  const overtimes = totalRounds > scoring.regulationRounds
    ? Math.max(0, Math.round((totalRounds - scoring.regulationRounds) / scoring.roundsPerOvertime))
    : 0;

  if (won) {
    return { won, averaj, overtimes, points: scoring.winPoints + averaj };
  }

  const series = Math.min(overtimes, scoring.maxOvertimeConsolationSeries);
  return { won, averaj, overtimes, points: series * scoring.overtimeConsolationPerSeries };
}

// ── Main standings computation ──────────────────────────────────────────────────

export function computeSuperligaStandings(params: {
  config: SuperligaConfig;
  sonmacByDate: SonmacByDate;
  captainsByDate: CaptainsByDateSnapshot | null;
  seasonStart: string | null;
  playersIndex: PlayersIndex;
  upToNight?: number;
}): {
  league: { id: string; name: string; standings: SuperligaPlayerStanding[] };
  datesIncluded: string[];
  warnings: string[];
} {
  const { config, sonmacByDate, captainsByDate, seasonStart, playersIndex, upToNight } = params;
  const scoring = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  const leagueMeta = config.leagues?.[0] || { id: 'superliga', name: 'Superliga', players: [] };

  const start = seasonStart || config.seasonStart || null;

  // Bir geceyi dahil etmek için: sezon başlangıcından sonra ve ana lig haritası olan
  // her sonmac gecesi. Kaptan atamasından bağımsızdır (puanlama maç sonuçlarından gelir).
  let datesIncluded = Object.keys(sonmacByDate || {})
    .filter((d) => {
      if (start && d < start) return false;
      const mapNames = getMainLeagueMapsForDate(sonmacByDate, d);
      return !!mapNames && mapNames.length > 0;
    })
    .sort();

  if (upToNight !== undefined && upToNight > 0) {
    datesIncluded = datesIncluded.slice(0, upToNight);
  }
  const datesIncludedSet = new Set(datesIncluded);

  // Hangi oyuncu hangi gece kaptanlık yaptı (dahil edilen geceler içinde)
  const captainDatesBySteamId = new Map<string, Set<string>>();
  if (captainsByDate) {
    for (const [date, rec] of Object.entries(captainsByDate)) {
      if (!datesIncludedSet.has(date)) continue;
      for (const teamKey of ['team1', 'team2'] as const) {
        const id = rec?.[teamKey]?.steamId;
        if (!id) continue;
        if (!captainDatesBySteamId.has(id)) captainDatesBySteamId.set(id, new Set());
        captainDatesBySteamId.get(id)!.add(date);
      }
    }
  }

  const leaguePlayers = new Set(leagueMeta.players || []);

  // steamId -> date -> map sonuçları
  const perPlayerNights = new Map<string, Map<string, SuperligaMapResult[]>>();
  function ensureNight(steamId: string, date: string): SuperligaMapResult[] {
    if (!perPlayerNights.has(steamId)) perPlayerNights.set(steamId, new Map());
    const byDate = perPlayerNights.get(steamId)!;
    if (!byDate.has(date)) byDate.set(date, []);
    return byDate.get(date)!;
  }

  for (const date of datesIncluded) {
    const night = sonmacByDate?.[date];
    const allMaps = night?.maps;
    if (!allMaps) continue;
    const mapNames = getMainLeagueMapsForDate(sonmacByDate, date) || [];

    for (const mapName of mapNames) {
      const m = allMaps[mapName];
      if (!m) continue;
      const s1 = typeof m?.team1?.score === 'number' ? m.team1.score : Number(m?.team1?.score);
      const s2 = typeof m?.team2?.score === 'number' ? m.team2.score : Number(m?.team2?.score);
      if (!Number.isFinite(s1) || !Number.isFinite(s2)) continue;

      const team1Res = computeMapPoints(s1, s2, scoring);
      const team2Res = computeMapPoints(s2, s1, scoring);
      if (!team1Res || !team2Res) continue;

      for (const p of m?.team1?.players || []) {
        const id = String(p?.steam_id || '').trim();
        if (!id || !leaguePlayers.has(id)) continue;
        ensureNight(id, date).push({
          mapName, scoreFor: s1, scoreAgainst: s2,
          won: team1Res.won, averaj: team1Res.averaj, overtimes: team1Res.overtimes, points: team1Res.points,
        });
      }
      for (const p of m?.team2?.players || []) {
        const id = String(p?.steam_id || '').trim();
        if (!id || !leaguePlayers.has(id)) continue;
        ensureNight(id, date).push({
          mapName, scoreFor: s2, scoreAgainst: s1,
          won: team2Res.won, averaj: team2Res.averaj, overtimes: team2Res.overtimes, points: team2Res.points,
        });
      }
    }
  }

  const standings: SuperligaPlayerStanding[] = [];

  for (const steamId of leagueMeta.players || []) {
    const name = displayNameForSteamId(steamId, playersIndex);
    const byDate = perPlayerNights.get(steamId);
    const captainDates = captainDatesBySteamId.get(steamId) || new Set<string>();

    const nightBreakdown: SuperligaNightEntry[] = [];
    let totalPoints = 0;
    let mapsPlayed = 0;
    let mapsWon = 0;

    const nightDates = byDate ? [...byDate.keys()].sort() : [];
    for (const date of nightDates) {
      const maps = byDate!.get(date)!;
      const mapPoints = maps.reduce((sum, mp) => sum + mp.points, 0);
      const isCaptain = captainDates.has(date);
      const captainBonus = isCaptain ? scoring.captainBonus : 0;
      const points = mapPoints + captainBonus;

      mapsPlayed += maps.length;
      mapsWon += maps.filter((mp) => mp.won).length;
      totalPoints += points;

      nightBreakdown.push({ date, isCaptain, captainBonus, mapPoints, points, maps });
    }

    nightBreakdown.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const nightsPlayed = nightDates.length;
    // Ortalama: gece başına puan (toplam değil). Oynamayan oyuncu 0 alır.
    const avgPoints = nightsPlayed > 0 ? totalPoints / nightsPlayed : 0;
    // Kaptanlık bonusu sadece oynanan gecelere uygulanır.
    const captainNights = nightDates.filter((d) => captainDates.has(d)).length;

    standings.push({
      steamId,
      name,
      nightsPlayed,
      mapsPlayed,
      mapsWon,
      captainNights,
      totalPoints,
      avgPoints,
      nightBreakdown,
    });
  }

  standings.sort((a, b) => {
    if (b.avgPoints !== a.avgPoints) return b.avgPoints - a.avgPoints;
    if (b.mapsWon !== a.mapsWon) return b.mapsWon - a.mapsWon;
    return a.name.localeCompare(b.name, 'tr');
  });

  const warnings: string[] = [];
  if (!datesIncluded.length) {
    warnings.push('Henüz Superliga gecesi yok (sezon başlangıcından sonra maç sonucu girilince burada görünür).');
  }

  return { league: { id: leagueMeta.id, name: leagueMeta.name, standings }, datesIncluded, warnings };
}

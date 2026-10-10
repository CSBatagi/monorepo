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
 * Bir gecenin lig hesabına girmesi için o gece her iki takıma da kaptan
 * atanmış olmalıdır. Kaptanı işlenmemiş geceler sıralamaya dahil edilmez.
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
  deriveMainLeagueTeamsForDate,
  getMainLeagueMapsForDate,
} from './batakAllStars';

// Re-export shared helpers so pages can import from one place
export { buildPlayersIndex, displayNameForSteamId, deriveTeamsForDate, deriveMainLeagueTeamsForDate, getMainLeagueMapsForDate };

// ── Config types ──────────────────────────────────────────────────────────────

export type SuperligaConfig = {
  version: number;
  seasonStart?: string;
  /** Son dahil gece (YYYY-MM-DD). Arşivlenen sezonlarda sonraki geceler sayılmaz. */
  seasonEnd?: string;
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
  manual?: boolean;     // elle eklenen (override) sonuç mu
};

// ── Manuel maç sonucu (override) ───────────────────────────────────────────────
// Bazı gecelerde bazı haritaların sonuçları sonmac verisinde eksik olabilir.
// Admin bu sonuçları elle ekleyebilir; lig hesabına dahil edilir.

export type SuperligaMapOverride = {
  date: string;
  mapName: string;
  team1Name?: string;
  team1Score: number;
  team2Name?: string;
  team2Score: number;
  setByUid?: string;
  setByName?: string;
  setAt?: number;
};

export type SuperligaMapOverridesByDate = Record<string, SuperligaMapOverride[]>;

// ── Tamamen manuel gece ────────────────────────────────────────────────────────
// Bazı geceler (ör. sadece oyun gecesi) hiç demo/istatistik üretmez. Bu geceler
// için admin, takım kadrolarını ve harita skorlarını tamamen elle girer; lig
// hesabına normal bir gece gibi dahil edilir. (Override'lardan farkı: burada
// kadro bilgisi de elle verilir, çünkü çıkarılacak sonmac verisi yoktur.)

export type SuperligaManualMap = {
  mapName: string;
  team1Score: number;
  team2Score: number;
};

export type SuperligaManualNight = {
  date: string;
  team1Name?: string;
  team2Name?: string;
  team1Players: Array<{ steamId: string; name?: string }>;
  team2Players: Array<{ steamId: string; name?: string }>;
  maps: SuperligaManualMap[];
  setByUid?: string;
  setByName?: string;
  setAt?: number;
};

export type SuperligaManualNightsByDate = Record<string, SuperligaManualNight>;

// ── Takım kadrosu çıkarımı (demo veya manuel) ──────────────────────────────────
// Bir gecenin takımlarını önce sonmac (demo) verisinden çıkarmaya çalışır; yoksa
// elle girilen manuel geceden döndürür. Kaptan atama gibi UI akışları her iki
// gece türüyle de çalışabilsin diye tek noktadan derlenir.

export type SuperligaDerivedTeams = {
  team1Name: string;
  team2Name: string;
  team1Players: Array<{ steamId: string; name?: string }>;
  team2Players: Array<{ steamId: string; name?: string }>;
  mapWinsTeam1: number;
  mapWinsTeam2: number;
  manual: boolean;
};

export function deriveSuperligaTeamsForDate(
  sonmacByDate: SonmacByDate,
  manualNights: SuperligaManualNightsByDate | null | undefined,
  date: string,
): SuperligaDerivedTeams | null {
  const demo = deriveMainLeagueTeamsForDate(sonmacByDate, date);
  if (demo) return { ...demo, manual: false };

  const mn = manualNights?.[date];
  if (mn) {
    let mapWinsTeam1 = 0;
    let mapWinsTeam2 = 0;
    for (const m of mn.maps || []) {
      const s1 = Number(m.team1Score);
      const s2 = Number(m.team2Score);
      if (Number.isFinite(s1) && Number.isFinite(s2)) {
        if (s1 > s2) mapWinsTeam1 += 1;
        else if (s2 > s1) mapWinsTeam2 += 1;
      }
    }
    return {
      team1Name: mn.team1Name || 'Takım 1',
      team2Name: mn.team2Name || 'Takım 2',
      team1Players: (mn.team1Players || []).map((p) => ({ steamId: String(p.steamId || '').trim(), name: p.name })),
      team2Players: (mn.team2Players || []).map((p) => ({ steamId: String(p.steamId || '').trim(), name: p.name })),
      mapWinsTeam1,
      mapWinsTeam2,
      manual: true,
    };
  }

  return null;
}

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

export type SuperligaMatchResult = {
  mapName: string;
  source: 'demo' | 'override' | 'manual';
  team1Name: string;
  team2Name: string;
  team1Ids: string[];
  team2Ids: string[];
  team1Score: number;
  team2Score: number;
  excludedReason: string | null;
};

/** The same effective map results are used for scoring and the public match audit. */
export function getSuperligaMatchResults(
  sonmacByDate: SonmacByDate,
  mapOverrides: SuperligaMapOverridesByDate | null | undefined,
  manualNights: SuperligaManualNightsByDate | null | undefined,
  date: string,
): { eligibleNight: boolean; maps: SuperligaMatchResult[] } {
  const demoMaps = sonmacByDate?.[date]?.maps || {};
  const mainNames = new Set(getMainLeagueMapsForDate(sonmacByDate, date) || []);
  const teams = deriveMainLeagueTeamsForDate(sonmacByDate, date);
  const overrides = mapOverrides?.[date] || [];
  const manual = manualNights?.[date];
  const maps: SuperligaMatchResult[] = [];
  const add = (map: SuperligaMatchResult) => {
    if (!map.excludedReason && (!Number.isFinite(map.team1Score) || !Number.isFinite(map.team2Score) || map.team1Score === map.team2Score)) {
      map.excludedReason = 'Geçerli sonuç yok';
    }
    maps.push(map);
  };
  for (const [mapName, map] of Object.entries(demoMaps)) {
    if (!map) continue;
    add({
      mapName, source: 'demo',
      team1Name: map.team1?.name || 'Takım 1', team2Name: map.team2?.name || 'Takım 2',
      team1Ids: (map.team1?.players || []).map((p) => String(p?.steam_id || '').trim()),
      team2Ids: (map.team2?.players || []).map((p) => String(p?.steam_id || '').trim()),
      team1Score: Number(map.team1?.score), team2Score: Number(map.team2?.score),
      excludedReason: mainNames.has(mapName) ? null : 'Ana lig dışı harita',
    });
  }
  for (const override of overrides) {
    const reversed = !!teams && override.team1Name === teams.team2Name && override.team2Name === teams.team1Name;
    add({
      mapName: override.mapName, source: 'override',
      team1Name: teams?.team1Name || override.team1Name || 'Takım 1',
      team2Name: teams?.team2Name || override.team2Name || 'Takım 2',
      team1Ids: teams?.team1Players.map((p) => p.steamId) || [],
      team2Ids: teams?.team2Players.map((p) => p.steamId) || [],
      team1Score: Number(reversed ? override.team2Score : override.team1Score),
      team2Score: Number(reversed ? override.team1Score : override.team2Score),
      excludedReason: !teams ? 'Takım kadrosu bulunamadı' : mainNames.has(override.mapName) && demoMaps[override.mapName] ? 'Demo sonucu zaten var' : null,
    });
  }
  for (const map of manual?.maps || []) {
    add({
      mapName: map.mapName, source: 'manual',
      team1Name: manual?.team1Name || 'Takım 1', team2Name: manual?.team2Name || 'Takım 2',
      team1Ids: (manual?.team1Players || []).map((p) => String(p.steamId || '').trim()),
      team2Ids: (manual?.team2Players || []).map((p) => String(p.steamId || '').trim()),
      team1Score: Number(map.team1Score), team2Score: Number(map.team2Score),
      excludedReason: mainNames.size ? 'Demo verisi kullanılıyor' : null,
    });
  }
  return { eligibleNight: mainNames.size > 0 || (!!teams && overrides.length > 0) || !!manual?.maps?.length, maps };
}

// ── Main standings computation ──────────────────────────────────────────────────

export function computeSuperligaStandings(params: {
  config: SuperligaConfig;
  sonmacByDate: SonmacByDate;
  captainsByDate: CaptainsByDateSnapshot | null;
  mapOverrides?: SuperligaMapOverridesByDate | null;
  manualNights?: SuperligaManualNightsByDate | null;
  seasonStart: string | null;
  seasonEnd?: string | null;
  playersIndex: PlayersIndex;
  upToNight?: number;
}): {
  league: { id: string; name: string; standings: SuperligaPlayerStanding[] };
  datesIncluded: string[];
  warnings: string[];
} {
  const { config, sonmacByDate, captainsByDate, mapOverrides, manualNights, seasonStart, playersIndex, upToNight } = params;
  const scoring = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  const leagueMeta = config.leagues?.[0] || { id: 'superliga', name: 'Superliga', players: [] };

  const start = seasonStart || config.seasonStart || null;
  const end = params.seasonEnd || config.seasonEnd || null;
  const outOfSeason = (d: string) => (!!start && d < start) || (!!end && d > end);

  // Bir geceyi dahil etmek için: sezon başlangıcından sonra ve ana lig haritası olan
  // her sonmac gecesi. Ayrıca elle eklenen (override) maç sonucu olan, takım
  // kadrosu çıkarılabilen geceler de dahil edilir.
  const dateSet = new Set<string>();
  for (const d of Object.keys(sonmacByDate || {})) {
    if (outOfSeason(d)) continue;
    const mapNames = getMainLeagueMapsForDate(sonmacByDate, d);
    if (mapNames && mapNames.length > 0) dateSet.add(d);
  }
  for (const d of Object.keys(mapOverrides || {})) {
    if (outOfSeason(d)) continue;
    if (!(mapOverrides?.[d] || []).length) continue;
    if (deriveMainLeagueTeamsForDate(sonmacByDate, d)) dateSet.add(d);
  }
  // Tamamen manuel geceler: demo verisi olmayan, en az bir harita sonucu elle
  // girilmiş her gece dahil edilir.
  for (const d of Object.keys(manualNights || {})) {
    if (outOfSeason(d)) continue;
    if (!(manualNights?.[d]?.maps || []).length) continue;
    dateSet.add(d);
  }

  // Kaptan filtresi: bir gece ancak her iki takıma da kaptan atanmışsa lig
  // hesabına girer. Kaptanı işlenmemiş geceler sıralamaya hiç dahil edilmez.
  const skippedNoCaptain: string[] = [];
  for (const d of [...dateSet]) {
    const rec = captainsByDate?.[d];
    if (!rec?.team1?.steamId || !rec?.team2?.steamId) {
      dateSet.delete(d);
      skippedNoCaptain.push(d);
    }
  }
  skippedNoCaptain.sort();

  let datesIncluded = [...dateSet].sort();

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

  // Bir haritanın puanını iki takım kadrosuna dağıtır.
  function awardMap(
    date: string,
    mapName: string,
    team1Ids: string[],
    team2Ids: string[],
    s1: number,
    s2: number,
    manual: boolean,
  ) {
    if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;
    const team1Res = computeMapPoints(s1, s2, scoring);
    const team2Res = computeMapPoints(s2, s1, scoring);
    if (!team1Res || !team2Res) return;

    for (const id of team1Ids) {
      if (!id || !leaguePlayers.has(id)) continue;
      ensureNight(id, date).push({
        mapName, scoreFor: s1, scoreAgainst: s2,
        won: team1Res.won, averaj: team1Res.averaj, overtimes: team1Res.overtimes, points: team1Res.points, manual,
      });
    }
    for (const id of team2Ids) {
      if (!id || !leaguePlayers.has(id)) continue;
      ensureNight(id, date).push({
        mapName, scoreFor: s2, scoreAgainst: s1,
        won: team2Res.won, averaj: team2Res.averaj, overtimes: team2Res.overtimes, points: team2Res.points, manual,
      });
    }
  }

  for (const date of datesIncluded) {
    for (const map of getSuperligaMatchResults(sonmacByDate, mapOverrides, manualNights, date).maps) {
      if (map.excludedReason) continue;
      awardMap(date, map.mapName, map.team1Ids, map.team2Ids, map.team1Score, map.team2Score, map.source !== 'demo');
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
    warnings.push(`Henüz ${leagueMeta.name} gecesi yok (sezon başlangıcından sonra maç sonucu girilip kaptanlar atanınca burada görünür).`);
  }
  if (skippedNoCaptain.length) {
    warnings.push(
      `Kaptan atanmadığı için sıralamaya girmeyen ${skippedNoCaptain.length} gece: ${skippedNoCaptain.join(', ')}. ` +
      'Her iki takıma da kaptan atanınca bu geceler otomatik olarak hesaba katılır.',
    );
  }

  return { league: { id: leagueMeta.id, name: leagueMeta.name, standings }, datesIncluded, warnings };
}

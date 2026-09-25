'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { useLivePolling } from '@/lib/useLivePolling';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from '@/lib/statsPeriods';
import { Crown, Star, Trophy } from 'lucide-react';

import type { CaptainsByDateSnapshot, SonmacByDate } from '@/lib/batakAllStars';
import {
  buildPlayersIndex,
  computeSuperligaStandings,
  DEFAULT_SUPERLIGA_SCORING,
  type SuperligaConfig,
  type SuperligaManualNightsByDate,
  type SuperligaMapOverridesByDate,
  type SuperligaPlayerStanding,
} from '@/lib/superliga';
import {
  CaptainAssignmentPanel,
  ManualNightPanel,
  MapOverridePanel,
  NightMapsDetail,
  PositionChangeIndicator,
  SeasonProgressBar,
  sortDatesDesc,
} from '@/components/superliga/SuperligaPanels';

type ActiveTab = 'standings' | 'raw' | 'kaptanlik' | 'overrides' | 'manual';

function ScoringReference({ config }: { config: SuperligaConfig }) {
  const s = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-sm">
      <h4 className="mb-2 flex items-center gap-1 font-semibold"><Star className="h-4 w-4" />Puanlama</h4>
      <ul className="list-inside list-disc space-y-1 text-gray-700">
        <li>Kazanılan her haritadan <span className="font-medium">{s.winPoints} puan + averaj</span> (skor farkı) kazanılır.</li>
        <li>Kaptanlar, kaptanlık yaptıkları her gece için <span className="font-medium">+{s.captainBonus} puan</span> alır.</li>
        <li>Uzatmaya giden haritalarda <span className="font-medium">kaybeden takım</span> her uzatma serisi için <span className="font-medium">+{s.overtimeConsolationPerSeries} teselli puanı</span> alır (en fazla {s.maxOvertimeConsolationSeries} seri = {s.maxOvertimeConsolationSeries * s.overtimeConsolationPerSeries} puan).</li>
        <li>Sıralama, oyuncunun <span className="font-medium">gece başına ortalama puanına</span> göre yapılır (toplam değil).</li>
        <li>Bir gecenin lige sayılması için <span className="font-medium">her iki takıma da kaptan atanmış olmalıdır</span>; kaptanı işlenmemiş geceler sıralamaya girmez.</li>
        <li>Token sistemi, saldırı/savunma/koruma ve HLTV faktörü <span className="font-medium">yoktur</span>. En önemli kriter kazanmaktır.</li>
      </ul>
      <div className="mt-3 rounded border border-purple-100 bg-white p-3 text-xs text-gray-600">
        <div className="mb-1 font-medium text-gray-700">Örnek — Darbe 2 - Cago 1</div>
        <div>Mirage 13-9 (Darbe) → 15 + 4 = <span className="font-medium">19</span></div>
        <div>Dust2 13-10 (Cago) → 15 + 3 = <span className="font-medium">18</span></div>
        <div>Anubis 13-7 (Darbe) → 15 + 6 = <span className="font-medium">21</span></div>
        <div className="mt-1">Darbe oyuncuları 19+21 = <span className="font-medium">40</span>, Cago oyuncuları <span className="font-medium">18</span> puan. Kaptanlar +5 ile Darbe 45, Cago 23.</div>
      </div>
      <div className="mt-3 rounded border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="mb-1 flex items-center gap-1 font-medium"><Trophy className="h-3.5 w-3.5" />Lig Sonu (Playoff)</div>
        1. ve 2. sıra doğrudan yarı finale çıkar. 3-6 ve 4-5 eşleşerek eleme oynar.
        Ardından 1 vs (4-5 galibi) ve 2 vs (3-6 galibi) yarı final oynar; galipler finalde karşılaşır.
      </div>
    </div>
  );
}


export default function SuperligaClient({
  sonmacByDate: initialSonmacByDate,
  seasonStart,
  seasonEnd = null,
  players,
  config,
}: {
  sonmacByDate: SonmacByDate;
  seasonStart: string | null;
  seasonEnd?: string | null;
  players: unknown;
  config: SuperligaConfig | null;
}) {
  const { user } = useSession();
  const [sonmacByDateData, setSonmacByDateData] = useState<SonmacByDate>(initialSonmacByDate || {});
  const sonmacByDate = sonmacByDateData;

  useEffect(() => {
    setSonmacByDateData(initialSonmacByDate || {});
  }, [initialSonmacByDate]);

  const effectiveConfig: SuperligaConfig = useMemo(() => {
    return config || {
      version: 1,
      scoring: DEFAULT_SUPERLIGA_SCORING,
      leagues: [{ id: 'superliga', name: 'Superliga', players: [] }],
    };
  }, [config]);

  const playersIndex = useMemo(() => buildPlayersIndex(players), [players]);

  useStatsRefresh({
    keys: ['sonmac_by_date_periods', 'sonmac_by_date'],
    onData: (payload) => {
      const nextSonmacByDate = isDateKeyedPeriodPayload<SonmacByDate[string]>(payload?.sonmac_by_date_periods) && payload.sonmac_by_date_periods.current_period
        ? getDateKeyedPeriodData(payload.sonmac_by_date_periods, payload.sonmac_by_date_periods.current_period)
        : payload?.sonmac_by_date;
      if (nextSonmacByDate && typeof nextSonmacByDate === 'object') {
        // Merge: the server may have passed dates from an older period (archived season).
        setSonmacByDateData((prev) => ({ ...prev, ...(nextSonmacByDate as SonmacByDate) }));
      }
    },
  });

  const { data: captainsData, refetch: refetchCaptains } = useLivePolling<{ captainsByDate: CaptainsByDateSnapshot }>({
    url: '/api/live/superliga-captains',
    intervalMs: 5000,
    initialData: { captainsByDate: {} },
  });
  const captainsByDate = captainsData.captainsByDate || null;

  const { data: overridesData, refetch: refetchOverrides } = useLivePolling<{ overridesByDate: SuperligaMapOverridesByDate }>({
    url: '/api/live/superliga-map-overrides',
    intervalMs: 5000,
    initialData: { overridesByDate: {} },
  });
  const mapOverrides = overridesData.overridesByDate || null;

  const { data: manualNightsData, refetch: refetchManualNights } = useLivePolling<{ manualNightsByDate: SuperligaManualNightsByDate }>({
    url: '/api/live/superliga-manual-nights',
    intervalMs: 5000,
    initialData: { manualNightsByDate: {} },
  });
  const manualNights = manualNightsData.manualNightsByDate || null;

  // Demo (sonmac) gecelerinin tarihleri — "Eksik Maç Ekle" ve puanlama için.
  const inSeason = useMemo(
    () => (date: string) => (!seasonStart || date >= seasonStart) && (!seasonEnd || date <= seasonEnd),
    [seasonStart, seasonEnd],
  );

  const demoDates = useMemo(() => {
    return sortDatesDesc(Object.keys(sonmacByDate || {}).filter(inSeason));
  }, [sonmacByDate, inSeason]);

  // Demo + manuel gece tarihlerinin birleşimi — kaptan atama gibi akışlar için.
  const availableDates = useMemo(() => {
    const set = new Set<string>(Object.keys(sonmacByDate || {}));
    for (const d of Object.keys(manualNights || {})) set.add(d);
    return sortDatesDesc([...set].filter(inSeason));
  }, [sonmacByDate, manualNights, inSeason]);

  const seasonLength = effectiveConfig.seasonLength && effectiveConfig.seasonLength > 0 ? effectiveConfig.seasonLength : 15;

  const [activeTab, setActiveTab] = useState<ActiveTab>('standings');
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [selectedProgressIndex, setSelectedProgressIndex] = useState<number | null>(null);

  const standingsData = useMemo(() => {
    return computeSuperligaStandings({
      config: effectiveConfig,
      sonmacByDate,
      captainsByDate,
      mapOverrides,
      manualNights,
      seasonStart,
      seasonEnd,
      playersIndex,
    });
  }, [captainsByDate, mapOverrides, manualNights, effectiveConfig, playersIndex, seasonStart, seasonEnd, sonmacByDate]);

  const totalPlayedNights = standingsData?.datesIncluded?.length ?? 0;
  const effectiveProgressIndex = selectedProgressIndex === null ? null : Math.min(selectedProgressIndex, totalPlayedNights);

  // Standings as of the selected night (history viewing). Null/last → current.
  const filteredStandingsData = useMemo(() => {
    if (effectiveProgressIndex === null || effectiveProgressIndex >= totalPlayedNights) return standingsData;
    return computeSuperligaStandings({
      config: effectiveConfig,
      sonmacByDate,
      captainsByDate,
      mapOverrides,
      manualNights,
      seasonStart,
      seasonEnd,
      playersIndex,
      upToNight: effectiveProgressIndex,
    });
  }, [captainsByDate, mapOverrides, manualNights, effectiveConfig, effectiveProgressIndex, playersIndex, seasonStart, seasonEnd, sonmacByDate, standingsData, totalPlayedNights]);

  // The night before the currently-viewed one, for position-change arrows.
  const previousStandingsData = useMemo(() => {
    const currentNightCount = effectiveProgressIndex ?? totalPlayedNights;
    if (currentNightCount <= 1) return null;
    return computeSuperligaStandings({
      config: effectiveConfig,
      sonmacByDate,
      captainsByDate,
      mapOverrides,
      manualNights,
      seasonStart,
      seasonEnd,
      playersIndex,
      upToNight: currentNightCount - 1,
    });
  }, [captainsByDate, mapOverrides, manualNights, effectiveConfig, effectiveProgressIndex, playersIndex, seasonStart, seasonEnd, sonmacByDate, totalPlayedNights]);

  const standingsWithChange = useMemo(() => {
    const rows = filteredStandingsData?.league?.standings || [];
    const prevMap = new Map<string, number>();
    previousStandingsData?.league?.standings?.forEach((player, idx) => prevMap.set(player.steamId, idx));

    return rows.map((player, idx) => {
      const prevIdx = prevMap.get(player.steamId);
      let positionChange: SuperligaPlayerStanding['positionChange'] = 'new';
      if (!previousStandingsData) positionChange = undefined;
      else if (prevIdx !== undefined) positionChange = idx < prevIdx ? 'up' : idx > prevIdx ? 'down' : 'same';
      return { ...player, positionChange };
    });
  }, [filteredStandingsData, previousStandingsData]);

  const rawDates = useMemo(() => sortDatesDesc(standingsData?.datesIncluded || []), [standingsData]);

  return (
    <div className="space-y-4">
      <ScoringReference config={effectiveConfig} />

      <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200 pb-1">
        {[
          { key: 'standings', label: 'Puan Durumu' },
          { key: 'raw', label: 'Ham Veri' },
          { key: 'kaptanlik', label: 'Kaptan Atama' },
          { key: 'overrides', label: 'Eksik Maç Ekle' },
          { key: 'manual', label: 'Manuel Gece' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as ActiveTab)}
            className={`rounded-t-md px-3 py-1.5 text-sm transition-colors ${activeTab === tab.key ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'standings' && (
        <div className="rounded border p-3">
          {totalPlayedNights > 0 && (
            <SeasonProgressBar
              played={totalPlayedNights}
              total={seasonLength}
              selectedIndex={selectedProgressIndex}
              onSelectIndex={setSelectedProgressIndex}
              dates={standingsData?.datesIncluded || []}
            />
          )}
          {(effectiveConfig.leagues?.[0]?.players || []).length === 0 ? (
            <div className="text-sm text-gray-700">Oyuncular tanımlı değil.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="w-10 px-2 py-2 text-center font-semibold text-gray-800">#</th>
                    <th className="w-8 px-1 py-2 text-center font-semibold text-gray-800" title="Pozisyon değişimi"></th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-800">Oyuncu</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-800" title="Oynanan gece">Gece</th>
                    <th className="hidden px-2 py-2 text-right font-semibold text-gray-800 sm:table-cell" title="Kazanılan / oynanan harita">Harita</th>
                    <th className="hidden px-2 py-2 text-right font-semibold text-gray-800 sm:table-cell" title="Kaptanlık gecesi">Kpt.</th>
                    <th className="hidden px-2 py-2 text-right font-semibold text-gray-800 sm:table-cell" title="Toplam puan">Top.</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-800" title="Gece başına ortalama puan">Ort.</th>
                  </tr>
                </thead>
                <tbody>
                  {standingsWithChange.map((player, idx) => {
                    const isExpanded = expandedPlayer === player.steamId;
                    const rankTone = idx === 0 ? 'bg-yellow-50' : idx === 1 ? 'bg-gray-50' : idx <= 5 ? 'bg-green-50/40' : '';
                    const rowClass = isExpanded ? 'bg-blue-50' : rankTone;

                    return (
                      <React.Fragment key={player.steamId}>
                        <tr
                          className={`cursor-pointer border-t hover:bg-gray-50 ${rowClass}`}
                          onClick={() => setExpandedPlayer(isExpanded ? null : player.steamId)}
                        >
                          <td className="px-2 py-2 text-center font-semibold text-gray-700">
                            <span className="inline-flex items-center gap-1">
                              {idx <= 1 && <Crown className="h-3.5 w-3.5 text-yellow-500" />}
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-1 py-2 text-center"><PositionChangeIndicator change={player.positionChange} /></td>
                          <td className="max-w-[120px] truncate px-2 py-2 font-medium sm:max-w-none">{player.name}</td>
                          <td className="px-2 py-2 text-right">{player.nightsPlayed}</td>
                          <td className="hidden px-2 py-2 text-right font-mono text-xs sm:table-cell">{player.mapsWon}/{player.mapsPlayed}</td>
                          <td className="hidden px-2 py-2 text-right sm:table-cell">{player.captainNights}</td>
                          <td className="hidden px-2 py-2 text-right font-mono text-xs text-gray-500 sm:table-cell">{player.totalPoints}</td>
                          <td className="px-2 py-2 text-right font-mono font-semibold text-purple-700">{player.avgPoints.toFixed(1)}</td>
                        </tr>
                        {isExpanded && player.nightBreakdown.length > 0 && (
                          <tr className="border-t bg-gray-50">
                            <td colSpan={8} className="px-3 py-2">
                              <table className="w-full text-xs">
                                <thead className="text-gray-500">
                                  <tr>
                                    <th className="px-2 py-1 text-left">Tarih</th>
                                    <th className="px-2 py-1 text-left">Haritalar</th>
                                    <th className="px-2 py-1 text-right">Kaptan</th>
                                    <th className="px-2 py-1 text-right">Gece Puanı</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {player.nightBreakdown.map((entry) => (
                                    <tr key={entry.date} className="border-t">
                                      <td className="whitespace-nowrap px-2 py-1 text-gray-600">{entry.date}</td>
                                      <td className="px-2 py-1"><NightMapsDetail entry={entry} /></td>
                                      <td className="px-2 py-1 text-right">{entry.isCaptain ? `+${entry.captainBonus}` : '-'}</td>
                                      <td className="px-2 py-1 text-right font-mono font-medium">{entry.points}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {standingsData?.warnings?.map((w, i) => (
            <p key={i} className="mt-2 text-sm text-amber-600">{w}</p>
          ))}
        </div>
      )}

      {activeTab === 'raw' && (
        <div className="rounded border p-3">
          {rawDates.length === 0 ? (
            <div className="text-sm text-gray-500">Henüz veri yok.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="sticky left-0 bg-gray-200 px-3 py-2 text-left font-semibold text-gray-800">Oyuncu</th>
                    {rawDates.map((date) => (
                      <th key={date} className="px-3 py-2 text-center font-semibold text-gray-800" title={date}>
                        <span className="font-mono">{date.slice(5)}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold text-gray-800">Toplam</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-800">Ort.</th>
                  </tr>
                </thead>
                <tbody>
                  {(standingsData?.league?.standings || []).map((player) => {
                    const byDate = new Map(player.nightBreakdown.map((entry) => [entry.date, entry] as const));
                    return (
                      <tr key={player.steamId} className="border-t">
                        <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium">{player.name}</td>
                        {rawDates.map((date) => {
                          const entry = byDate.get(date);
                          if (!entry) {
                            return <td key={date} className="px-3 py-2 text-center text-gray-400">-</td>;
                          }
                          return (
                            <td key={date} className="px-3 py-2 text-center">
                              <div className="font-mono font-semibold text-gray-900">{entry.points}</div>
                              <div className="text-[10px] font-mono text-gray-500">
                                {entry.mapPoints}{entry.captainBonus ? `+${entry.captainBonus}k` : ''}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-mono font-semibold text-gray-700">{player.totalPoints}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-purple-700">{player.avgPoints.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'kaptanlik' && (
        <CaptainAssignmentPanel
          availableDates={availableDates}
          sonmacByDate={sonmacByDate}
          manualNights={manualNights}
          captainsByDate={captainsByDate}
          playersIndex={playersIndex}
          user={user}
          refetchCaptains={refetchCaptains}
        />
      )}

      {activeTab === 'overrides' && (
        <MapOverridePanel
          scoring={effectiveConfig.scoring}
          availableDates={demoDates}
          sonmacByDate={sonmacByDate}
          mapOverrides={mapOverrides}
          user={user}
          onSaved={refetchOverrides}
        />
      )}

      {activeTab === 'manual' && (
        <ManualNightPanel
          scoring={effectiveConfig.scoring}
          poolSteamIds={effectiveConfig.leagues?.[0]?.players || []}
          seasonStart={seasonStart}
          seasonEnd={seasonEnd}
          sonmacByDate={sonmacByDate}
          manualNights={manualNights}
          captainsByDate={captainsByDate}
          playersIndex={playersIndex}
          user={user}
          onSaved={refetchManualNights}
          refetchCaptains={refetchCaptains}
        />
      )}
    </div>
  );
}

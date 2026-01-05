'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { off, onValue, ref, set } from 'firebase/database';

import {
  buildPlayersIndex,
  computeStandings,
  deriveTeamsForDate,
  type AllStarsConfig,
  type CaptainsByDateSnapshot,
  type NightAvgData,
  type NightAvgRow,
  type SonmacByDate,
  type CaptainRecord,
} from '@/lib/batakAllStars';

const CLEAR_ATTENDANCE_PASSWORD = process.env.NEXT_PUBLIC_CLEAR_ATTENDANCE_PASSWORD || 'osirikler';

type TeamKey = 'team1' | 'team2';

function sortDatesDesc(dates: string[]): string[] {
  return [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function formatNumber(value: unknown, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(decimals);
}

export default function BatakAllStarsClient({
  nightAvg,
  sonmacByDate,
  seasonStart,
  players,
  config,
}: {
  nightAvg: NightAvgData;
  sonmacByDate: SonmacByDate;
  seasonStart: string | null;
  players: unknown;
  config: AllStarsConfig | null;
}) {
  const { user } = useAuth();

  const effectiveConfig: AllStarsConfig = useMemo(() => {
    return (
      (config as AllStarsConfig) || {
        version: 1,
        scoring: {
          useStat: 'HLTV 2',
          seriesPoints: { '2-0W': 1, '2-1W': 0.75, '1-1D': 0.5, '2-1L': 0.25, '2-0L': 0 },
          tokenRule: { dropWorstNights: 'captainTokens' },
        },
        leagues: [],
      }
    );
  }, [config]);

  const playersIndex = useMemo(() => buildPlayersIndex(players), [players]);

  const availableDates = useMemo(() => {
    const dates = Object.keys(nightAvg || {});
    const filtered = seasonStart ? dates.filter((d) => d >= seasonStart) : dates;
    return sortDatesDesc(filtered);
  }, [nightAvg, seasonStart]);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const [captainsByDate, setCaptainsByDate] = useState<CaptainsByDateSnapshot | null>(null);

  const nightRows = useMemo(() => {
    const rows = (selectedDate && nightAvg?.[selectedDate]) ? nightAvg[selectedDate] : [];
    return [...rows].sort((a, b) => {
      const av = Number(a?.['HLTV 2'] ?? a?.HLTV2 ?? a?.hltv2 ?? 0);
      const bv = Number(b?.['HLTV 2'] ?? b?.HLTV2 ?? b?.hltv2 ?? 0);
      return bv - av;
    });
  }, [nightAvg, selectedDate]);

  const teams = useMemo(() => {
    if (!selectedDate) return null;
    return deriveTeamsForDate(sonmacByDate || {}, selectedDate);
  }, [sonmacByDate, selectedDate]);

  const nightRowBySteamId = useMemo(() => {
    const map = new Map<string, NightAvgRow>();
    for (const r of nightRows) {
      if (r?.steam_id) map.set(r.steam_id, r);
    }
    return map;
  }, [nightRows]);

  const [savedCaptains, setSavedCaptains] = useState<Record<TeamKey, CaptainRecord | null>>({
    team1: null,
    team2: null,
  });
  const [captainSteamIds, setCaptainSteamIds] = useState<Record<TeamKey, string>>({ team1: '', team2: '' });
  const [savingTeam, setSavingTeam] = useState<Record<TeamKey, boolean>>({ team1: false, team2: false });
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'standings' | 'raw'>('standings');

  // Load all captains once for standings/tokens.
  useEffect(() => {
    const baseRef = ref(db, 'batakAllStars/captainsByDate');
    const unsub = onValue(
      baseRef,
      (snap) => {
        const val = (snap.val() || null) as CaptainsByDateSnapshot | null;
        setCaptainsByDate(val);
      },
      () => {
        // ignore
      }
    );
    return () => off(baseRef, 'value', unsub);
  }, []);

  const standingsData = useMemo(() => {
    if (!effectiveConfig) return null;
    return computeStandings({
      config: effectiveConfig,
      nightAvg,
      sonmacByDate,
      captainsByDate,
      seasonStart,
      playersIndex,
    });
  }, [captainsByDate, effectiveConfig, nightAvg, playersIndex, seasonStart, sonmacByDate]);

  // Default date selection
  useEffect(() => {
    if (!selectedDate && availableDates.length) setSelectedDate(availableDates[0]);
  }, [availableDates, selectedDate]);

  // If season start changes (or data loads) and selectedDate is out of range, fix it.
  useEffect(() => {
    if (!selectedDate) return;
    if (seasonStart && selectedDate < seasonStart) {
      setSelectedDate(availableDates[0] || '');
    }
  }, [availableDates, seasonStart, selectedDate]);

  // Load saved captain for the selected date
  useEffect(() => {
    setMessage(null);
    setSavedCaptains({ team1: null, team2: null });
    setCaptainSteamIds({ team1: '', team2: '' });

    if (!selectedDate) return;

    const team1Ref = ref(db, `batakAllStars/captainsByDate/${selectedDate}/team1`);
    const team2Ref = ref(db, `batakAllStars/captainsByDate/${selectedDate}/team2`);

    const unsub1 = onValue(
      team1Ref,
      (snap) => {
        const val = (snap.val() || null) as CaptainRecord | null;
        setSavedCaptains((prev) => ({ ...prev, team1: val }));
        setCaptainSteamIds((prev) => ({ ...prev, team1: val?.steamId || '' }));
      },
      () => {
        // ignore
      }
    );
    const unsub2 = onValue(
      team2Ref,
      (snap) => {
        const val = (snap.val() || null) as CaptainRecord | null;
        setSavedCaptains((prev) => ({ ...prev, team2: val }));
        setCaptainSteamIds((prev) => ({ ...prev, team2: val?.steamId || '' }));
      },
      () => {
        // ignore
      }
    );

    return () => {
      off(team1Ref, 'value', unsub1);
      off(team2Ref, 'value', unsub2);
    };
  }, [selectedDate]);

  const handleSaveTeamCaptain = async (teamKey: TeamKey) => {
    if (!user) {
      setMessage('Giriş gerekli.');
      return;
    }
    if (!selectedDate) {
      setMessage('Bir tarih seçin.');
      return;
    }
    if (!teams) {
      setMessage('Bu gece için maç takım verisi bulunamadı.');
      return;
    }

    const roster = teamKey === 'team1' ? teams.team1Players : teams.team2Players;
    const teamName = teamKey === 'team1' ? teams.team1Name : teams.team2Name;
    const chosenSteamId = captainSteamIds[teamKey];
    const exists = roster.some((p) => p.steamId === chosenSteamId);
    if (!chosenSteamId || !exists) {
      setMessage('Kaptan, o takımın oyuncularından biri olmalı.');
      return;
    }

    const saved = savedCaptains[teamKey];
    if (saved?.steamId && saved.steamId !== chosenSteamId) {
      const ok = window.confirm(`${teamName} için zaten bir kaptan seçilmiş. Değiştirilsin mi?`);
      if (!ok) return;
    }

    const password = window.prompt('Kaptanı kaydetmek için şifre girin:');
    if (password === null) return;
    if (password !== CLEAR_ATTENDANCE_PASSWORD) {
      setMessage('Hatalı şifre.');
      return;
    }

    const captainName = roster.find((p) => p.steamId === chosenSteamId)?.name;
    const record: CaptainRecord = {
      steamId: chosenSteamId,
      steamName: captainName,
      date: selectedDate,
      teamKey,
      teamName,
      setByUid: user.uid,
      setByName: user.displayName || user.email || undefined,
      setAt: Date.now(),
    };

    setSavingTeam((prev) => ({ ...prev, [teamKey]: true }));
    setMessage(null);
    try {
      await set(ref(db, `batakAllStars/captainsByDate/${selectedDate}/${teamKey}`), record);
      setMessage('Kaydedildi.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'bilinmeyen hata';
      setMessage(`Kaydetme başarısız: ${msg}`);
    } finally {
      setSavingTeam((prev) => ({ ...prev, [teamKey]: false }));
    }
  };

  const seriesPoints = effectiveConfig?.scoring?.seriesPoints;
  const includedNightsCount = standingsData?.datesIncluded?.length ?? 0;
  const includedDates = standingsData?.datesIncluded ?? [];

  return (
    <div className="space-y-4">
      <div>
        {/* Sub Tab Navigation */}
        <div className="mb-4 border-b border-gray-200">
          <ul id="batak-allstars-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
            <li className="mr-2" role="presentation">
              <button
                className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === 'standings' ? 'active border-blue-600 text-blue-600' : 'border-transparent hover:text-gray-600 hover:border-gray-300'}`}
                id="batak-allstars-standings-tab"
                type="button"
                role="tab"
                aria-controls="batak-allstars-tab-standings"
                aria-selected={activeTab === 'standings'}
                onClick={() => setActiveTab('standings')}
              >
                Sıralama
              </button>
            </li>
            <li className="mr-2" role="presentation">
              <button
                className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === 'raw' ? 'active border-blue-600 text-blue-600' : 'border-transparent hover:text-gray-600 hover:border-gray-300'}`}
                id="batak-allstars-raw-tab"
                type="button"
                role="tab"
                aria-controls="batak-allstars-tab-raw"
                aria-selected={activeTab === 'raw'}
                onClick={() => setActiveTab('raw')}
              >
                Ham Veri
              </button>
            </li>
          </ul>
        </div>

        {activeTab === 'standings' ? (
          <div id="batak-allstars-tab-standings" role="tabpanel" aria-labelledby="batak-allstars-standings-tab">
            <div className="border rounded p-3">
              <div className="text-lg font-semibold text-gray-800 mb-2">Lig Sıralaması</div>
              {standingsData?.warnings?.length ? (
                <div className="text-sm text-gray-700 mb-2">{standingsData.warnings.join(' ')}</div>
              ) : null}
              <div className="text-xs text-gray-500 mb-3">
                Puan = ortalama(HLTV2 + gece sonucu puanı). En kötü <span className="font-mono">Kpt.</span> kadar gece çıkarılır.
              </div>

              <div className="border rounded p-3 bg-gray-50 mb-3">
                <div className="text-sm font-semibold text-gray-800 mb-2">Hesaplama</div>
                <div className="text-xs text-gray-700 space-y-1">
                  <div>
                    <span className="font-medium">Gece puanı</span> = <span className="font-mono">HLTV2</span> + <span className="font-mono">Kazanma/Kaybetme Puanı</span>
                  </div>
                  <div>
                    <span className="font-medium">Kazanma/Kaybetme Puanı</span> (gece toplam map sonucu):
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-[420px] text-xs border rounded bg-white">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="text-left px-2 py-1">Sonuç</th>
                            <th className="text-left px-2 py-1">Açıklama</th>
                            <th className="text-right px-2 py-1">Puan</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="px-2 py-1 font-mono">2-0</td>
                            <td className="px-2 py-1">Kazandı</td>
                            <td className="px-2 py-1 text-right font-mono">{(seriesPoints?.['2-0W'] ?? 1).toFixed(2)}</td>
                          </tr>
                          <tr className="bg-gray-50">
                            <td className="px-2 py-1 font-mono">2-1</td>
                            <td className="px-2 py-1">Kazandı</td>
                            <td className="px-2 py-1 text-right font-mono">{(seriesPoints?.['2-1W'] ?? 0.75).toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1 font-mono">1-1</td>
                            <td className="px-2 py-1">Berabere</td>
                            <td className="px-2 py-1 text-right font-mono">{(seriesPoints?.['1-1D'] ?? 0.5).toFixed(2)}</td>
                          </tr>
                          <tr className="bg-gray-50">
                            <td className="px-2 py-1 font-mono">1-2</td>
                            <td className="px-2 py-1">Kaybetti</td>
                            <td className="px-2 py-1 text-right font-mono">{(seriesPoints?.['2-1L'] ?? 0.25).toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1 font-mono">0-2</td>
                            <td className="px-2 py-1">Kaybetti</td>
                            <td className="px-2 py-1 text-right font-mono">{(seriesPoints?.['2-0L'] ?? 0).toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Kpt.</span> = kaptanlık sayısı (sadece All-Stars gecelerinde).
                  </div>
                  <div>
                    <span className="font-medium">Sezon puanı</span> = oynanan gecelerin puan ortalaması, en düşük <span className="font-mono">Kpt.</span> kadar gece çıkarılarak hesaplanır (en az 1 gece kalır).
                  </div>
                  <div>
                    <span className="font-medium">Dahil edilen geceler</span>: Sezon başlangıcından sonra, iki takım kaptanı da girilmiş geceler. Şu an <span className="font-mono">{includedNightsCount}</span> gece dahil.
                  </div>
                </div>
              </div>

              {(effectiveConfig.leagues || []).length === 0 ? (
                <div className="text-sm text-gray-700">
                  Ligler tanımlı değil. <span className="font-mono">/data/batak_allstars_config.json</span> dosyasını düzenleyin.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {effectiveConfig.leagues.map((league) => {
                    const block = standingsData?.byLeague?.[league.id];
                    const rows = block?.standings || [];
                    return (
                      <div key={league.id} className="border rounded p-3">
                        <div className="text-base font-semibold text-gray-800 mb-2">{league.name}</div>
                        <div className="overflow-x-auto border rounded">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-200">
                              <tr>
                                <th className="text-left px-3 py-2 font-semibold text-gray-800">Oyuncu</th>
                                <th className="text-right px-3 py-2 font-semibold text-gray-800">Oyn.</th>
                                <th className="text-right px-3 py-2 font-semibold text-gray-800">Kpt.</th>
                                <th className="text-right px-3 py-2 font-semibold text-gray-800">Puan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, idx) => {
                                const isTop = idx === 0;
                                const isBottom = idx === rows.length - 1 && !isTop;
                                const rowClass = isTop ? 'bg-green-50' : isBottom ? 'bg-red-50' : '';
                                return (
                                  <tr key={r.steamId || r.name} className={rowClass}>
                                    <td className="px-3 py-2 font-medium">{r.name}</td>
                                    <td className="px-3 py-2 text-right">{r.oyn}</td>
                                    <td className="px-3 py-2 text-right">{r.kpt}</td>
                                    <td className="px-3 py-2 text-right">{r.puanAdj.toFixed(3)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div id="batak-allstars-tab-raw" role="tabpanel" aria-labelledby="batak-allstars-raw-tab">
            <div className="border rounded p-3">
              <div className="flex flex-col gap-1 mb-3">
                <div className="text-lg font-semibold text-gray-800">Ham Veri (HLTV2 + Kazanma/Kaybetme)</div>
                <div className="text-xs text-gray-600">
                  Kırmızı <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">Çıkarıldı</span> etiketi, token nedeniyle ortalamaya dahil edilmeyen geceyi gösterir.
                </div>
              </div>

              {includedDates.length === 0 ? (
                <div className="text-sm text-gray-700">Henüz dahil edilen gece yok. (İki takım kaptanını da girin.)</div>
              ) : (
                <div className="space-y-4">
                  {(effectiveConfig.leagues || []).map((league) => {
                    const block = standingsData?.byLeague?.[league.id];
                    const rows = block?.standings || [];

                    return (
                      <div key={league.id} className="border rounded p-3">
                        <div className="text-base font-semibold text-gray-800 mb-2">{league.name}</div>
                        <div className="overflow-x-auto border rounded">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-200">
                              <tr>
                                <th className="sticky left-0 bg-gray-200 text-left px-3 py-2 font-semibold text-gray-800">Oyuncu</th>
                                {includedDates.map((d) => (
                                  <th key={d} className="text-center px-3 py-2 font-semibold text-gray-800" title={d}>
                                    <span className="font-mono">{d.slice(5)}</span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => {
                                const byDate = new Map((r.nightBreakdown || []).map((n) => [n.date, n] as const));
                                return (
                                  <tr key={r.steamId || r.name} className="border-t">
                                    <td className="sticky left-0 bg-white px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                                    {includedDates.map((d) => {
                                      const n = byDate.get(d);
                                      if (!n) {
                                        return (
                                          <td key={d} className="px-3 py-2 text-center text-gray-400">-</td>
                                        );
                                      }
                                      const dropped = n.dropped;
                                      return (
                                        <td key={d} className={`px-3 py-2 text-center ${dropped ? 'bg-red-50' : ''}`}>
                                          <div className={`font-mono ${dropped ? 'text-red-700' : 'text-gray-800'}`}>{n.points.toFixed(3)}</div>
                                          <div className="text-[10px] text-gray-600 font-mono">
                                            {n.hltv2.toFixed(3)} + {n.bonus.toFixed(2)}
                                          </div>
                                          {dropped ? (
                                            <div className="mt-1">
                                              <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">Çıkarıldı</span>
                                            </div>
                                          ) : null}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Tarih</label>
          <select
            className="border rounded px-2 py-2 text-sm w-full md:w-56"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            disabled={!availableDates.length}
          >
            {availableDates.length === 0 ? (
              <option value="">Gece istatistiği bulunamadı</option>
            ) : (
              availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {message && (
        <div className="text-sm text-gray-700">{message}</div>
      )}


      {!teams ? (
        <div className="text-sm text-gray-700">
          Bu gece için takım verisi henüz yok (<span className="font-mono">sonmac_by_date.json</span> içinde eksik).
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['team1', 'team2'] as TeamKey[]).map((teamKey) => {
            const teamName = teamKey === 'team1' ? teams.team1Name : teams.team2Name;
            const roster = teamKey === 'team1' ? teams.team1Players : teams.team2Players;
            const saved = savedCaptains[teamKey];
            const selectedCaptainSteamId = captainSteamIds[teamKey];
            const isSaving = savingTeam[teamKey];

            const rows = roster
              .map((p) => ({
                steamId: p.steamId,
                name: p.name,
                nightRow: nightRowBySteamId.get(p.steamId),
              }))
              .sort((a, b) => {
                const av = Number(a.nightRow?.['HLTV 2'] ?? 0);
                const bv = Number(b.nightRow?.['HLTV 2'] ?? 0);
                return bv - av;
              });

            return (
              <div key={teamKey} className="border rounded p-3">
                <div className="flex items-end justify-between gap-3 mb-3">
                  <div>
                    <div className="text-sm text-gray-500">Takım</div>
                    <div className="text-lg font-semibold text-gray-800">{teamName}</div>
                    {saved?.steamId ? (
                      <div className="text-xs text-gray-600 mt-1">
                        Kaydedilen kaptan: <span className="font-medium">{saved.steamName || saved.steamId}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <select
                      className="border rounded px-2 py-2 text-sm w-64"
                      value={selectedCaptainSteamId}
                      onChange={(e) => setCaptainSteamIds((prev) => ({ ...prev, [teamKey]: e.target.value }))}
                      disabled={!selectedDate || roster.length === 0}
                    >
                      <option value="">Kaptan seç</option>
                      {roster.map((p) => (
                        <option key={p.steamId} value={p.steamId}>
                          {p.name || p.steamId}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleSaveTeamCaptain(teamKey)}
                      disabled={isSaving || !selectedCaptainSteamId}
                      className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-700 transition-colors text-white disabled:opacity-60 disabled:hover:bg-blue-600"
                    >
                      {isSaving ? 'Kaydediliyor…' : 'Kaptanı kaydet'}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto border rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                          <th className="text-left px-3 py-2">Oyuncu</th>
                        <th className="text-right px-3 py-2">HLTV2</th>
                        <th className="text-right px-3 py-2">ADR</th>
                        <th className="text-right px-3 py-2">K/D</th>
                          <th className="text-right px-3 py-2">Maç</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-gray-600" colSpan={5}>
                              Bu takımda oyuncu bulunamadı.
                          </td>
                        </tr>
                      ) : (
                        rows.map((r) => {
                          const isCaptain = selectedCaptainSteamId && r.steamId === selectedCaptainSteamId;
                          const nightRow = r.nightRow;
                          return (
                            <tr key={r.steamId} className={isCaptain ? 'bg-gray-50' : ''}>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">{r.name || nightRow?.name || r.steamId}</span>
                                  {isCaptain ? (
                                    <span className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700">Kaptan</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">{formatNumber(nightRow?.['HLTV 2'], 3)}</td>
                              <td className="px-3 py-2 text-right">{formatNumber(nightRow?.['ADR'], 1)}</td>
                              <td className="px-3 py-2 text-right">{formatNumber(nightRow?.['K/D'], 2)}</td>
                              <td className="px-3 py-2 text-right">{formatNumber(nightRow?.['Nr of Matches'], 0)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-gray-500">
        Kaptanlar Firebase içinde tutulur: <span className="font-mono">batakAllStars/captainsByDate/&lt;YYYY-MM-DD&gt;/team1</span> ve <span className="font-mono">.../team2</span>.
      </div>
    </div>
  );
}

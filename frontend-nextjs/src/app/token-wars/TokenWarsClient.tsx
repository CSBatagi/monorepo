'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession, type SessionUser } from '@/contexts/SessionContext';
import { useLivePolling } from '@/lib/useLivePolling';
import { setCaptain, setTokenWarsAction, deleteTokenWarsAction } from '@/lib/liveApi';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CheckCircle,
  Circle,
  Lock,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Unlock,
} from 'lucide-react';

import type {
  CaptainRecord,
  CaptainsByDateSnapshot,
  NightAvgData,
  SonmacByDate,
} from '@/lib/batakAllStars';
import {
  buildPlayersIndex,
  computeCaptainTokens,
  computeTokenWarsStandings,
  deriveTeamsForDate,
  displayNameForSteamId,
  getPlayerLeague,
  type NightBreakdownEntry,
  type TokenAction,
  type TokenWarsConfig,
  type TokenWarsPlayerStanding,
  type TokensByDateSnapshot,
} from '@/lib/tokenWars';

const CLEAR_ATTENDANCE_PASSWORD = process.env.NEXT_PUBLIC_CLEAR_ATTENDANCE_PASSWORD || 'osirikler';
const SEASON_LENGTH = 15;

type TeamKey = 'team1' | 'team2';
type ActiveTab = 'standings' | 'raw' | 'kaptanlik' | 'tokens';

function sortDatesDesc(dates: string[]): string[] {
  return [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function formatNumber(value: unknown, decimals = 0): string {
  if (value === null || value === undefined) return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(decimals);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Bilinmeyen hata';
}

function PositionChangeIndicator({ change }: { change?: 'up' | 'down' | 'same' | 'new' }) {
  switch (change) {
    case 'up':
      return <span title="Yükseldi" className="inline-flex text-green-600"><ArrowUp className="h-4 w-4" strokeWidth={2.5} /></span>;
    case 'down':
      return <span title="Düştü" className="inline-flex text-red-600"><ArrowDown className="h-4 w-4" strokeWidth={2.5} /></span>;
    case 'same':
      return <span title="Aynı" className="inline-flex text-gray-400"><Circle className="h-3 w-3" /></span>;
    case 'new':
      return <span title="Yeni" className="inline-flex text-blue-500"><Sparkles className="h-4 w-4" /></span>;
    default:
      return <span className="text-gray-300">-</span>;
  }
}

function KriteriaMet({ met }: { met?: boolean }) {
  if (met) {
    return <span title="5 maç + 1 kaptanlık tamam" className="inline-flex text-green-600"><CheckCircle className="h-4 w-4" /></span>;
  }
  return <span className="text-gray-300">-</span>;
}

function TokenBadge({ type }: { type: string }) {
  switch (type) {
    case 'delete_worst':
      return <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700"><Trash2 className="h-3 w-3" />Sil</span>;
    case 'lock_best':
      return <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700"><Lock className="h-3 w-3" />Kitle</span>;
    case 'protect_best':
      return <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"><Shield className="h-3 w-3" />Koru</span>;
    case 'unlock':
      return <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"><Unlock className="h-3 w-3" />Aç</span>;
    default:
      return null;
  }
}

function getNightStateTone(entry: NightBreakdownEntry): string {
  if (entry.deleted) return 'bg-red-50';
  if (entry.locked) return 'bg-amber-50';
  if (entry.unlocked) return 'bg-green-50';
  if (entry.protected) return 'bg-blue-50';
  return '';
}

function NightStateBadges({ entry }: { entry: NightBreakdownEntry }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
      {entry.deleted && <TokenBadge type="delete_worst" />}
      {entry.locked && <TokenBadge type="lock_best" />}
      {entry.protected && <TokenBadge type="protect_best" />}
      {entry.unlocked && <TokenBadge type="unlock" />}
      {!entry.deleted && !entry.locked && !entry.protected && !entry.unlocked && (
        <span className="text-[10px] text-gray-400">-</span>
      )}
    </div>
  );
}

function SeasonProgressBar({
  played,
  total,
  selectedIndex,
  onSelectIndex,
  dates,
}: {
  played: number;
  total: number;
  selectedIndex: number | null;
  onSelectIndex: (i: number | null) => void;
  dates: string[];
}) {
  const effectiveIndex = selectedIndex === null ? played : Math.min(selectedIndex, played);
  const squares = [];

  for (let i = 0; i < total; i++) {
    const matchNum = i + 1;
    const isPlayed = i < played;
    const isSelected = effectiveIndex === matchNum;
    const isBeforeSelected = matchNum <= effectiveIndex;
    const bgClass = isPlayed ? (isSelected ? 'bg-purple-600' : isBeforeSelected ? 'bg-purple-400' : 'bg-purple-200') : 'bg-gray-200';
    const textClass = isPlayed ? (isSelected || isBeforeSelected ? 'text-white' : 'text-purple-600') : 'text-gray-400';
    const borderClass = isSelected ? 'ring-2 ring-purple-800 ring-offset-1' : '';

    squares.push(
      <button
        key={i}
        type="button"
        onClick={() => isPlayed ? onSelectIndex(selectedIndex === matchNum ? null : matchNum) : onSelectIndex(null)}
        className={`flex h-7 w-7 items-center justify-center rounded-sm text-xs font-medium transition-all duration-150 sm:h-8 sm:w-8 md:h-6 md:w-6 ${bgClass} ${textClass} ${borderClass} ${isPlayed ? 'cursor-pointer hover:scale-110' : 'cursor-default opacity-60'}`}
        title={isPlayed ? `Maç ${matchNum}: ${dates[i] || ''}` : `Maç ${matchNum} (oynanmadı)`}
      >
        {matchNum}
      </button>,
    );
  }

  const viewingText = selectedIndex === null || selectedIndex >= played ? `Güncel (${played} maç)` : `Maç ${selectedIndex} sonrası`;

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5">{squares}</div>
      <div className="text-xs text-gray-500">
        {played} / {total} maç oynandı - Görüntülenen: <span className="font-medium text-purple-600">{viewingText}</span>
      </div>
      {selectedIndex !== null && selectedIndex < played && (
        <button type="button" onClick={() => onSelectIndex(null)} className="text-xs text-purple-500 underline hover:text-purple-700">
          Güncel duruma dön
        </button>
      )}
    </div>
  );
}

function ScoringReference({ config }: { config: TokenWarsConfig }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-sm">
      <h4 className="mb-2 flex items-center gap-1 font-semibold"><Swords className="h-4 w-4" />Puanlama</h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h5 className="mb-1 font-medium text-gray-700">Performans Puanı (HLTV2 DIFF)</h5>
          <table className="w-full text-xs">
            <tbody>
              {config.scoring.performancePoints.map((b, i) => (
                <tr key={i} className="border-b border-gray-200 last:border-0">
                  <td className="py-0.5 text-gray-500">
                    {b.min === -999 ? `< ${b.max.toFixed(2)}` : b.max === 999 ? `>= ${b.min.toFixed(2)}` : `${b.min.toFixed(2)} - ${b.max.toFixed(2)}`}
                  </td>
                  <td className="py-0.5 text-right font-medium">{b.points} puan</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h5 className="mb-1 font-medium text-gray-700">Takım Puanı</h5>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(config.scoring.teamPoints).map(([key, value]) => (
                <tr key={key} className="border-b border-gray-200 last:border-0">
                  <td className="py-0.5 text-gray-500">{key.replace('W', ' Galibiyet').replace('D', ' Beraberlik').replace('L', ' Mağlubiyet')}</td>
                  <td className="py-0.5 text-right font-medium">{value} puan</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 border-t border-gray-200 pt-2">
        <h5 className="mb-1 font-medium text-gray-700">Token Kullanımları</h5>
        <div className="flex flex-wrap gap-2">
          <TokenBadge type="delete_worst" /><span className="text-xs text-gray-600">En kötü geceni sil</span>
          <span className="text-gray-300">|</span>
          <TokenBadge type="lock_best" /><span className="text-xs text-gray-600">Rakibin en iyi gecesini kitle</span>
          <span className="text-gray-300">|</span>
          <TokenBadge type="protect_best" /><span className="text-xs text-gray-600">En iyi geceni koru</span>
          <span className="text-gray-300">|</span>
          <TokenBadge type="unlock" /><span className="text-xs text-gray-600">Kilidi aç</span>
        </div>
      </div>
    </div>
  );
}

function AdminTokenPanel({
  config,
  captainsByDate,
  tokensByDate,
  datesIncluded,
  playersIndex,
  onSubmitToken,
  onDeleteToken,
  user,
}: {
  config: TokenWarsConfig;
  captainsByDate: CaptainsByDateSnapshot | null;
  tokensByDate: TokensByDateSnapshot | null;
  datesIncluded: string[];
  playersIndex: ReturnType<typeof buildPlayersIndex>;
  onSubmitToken: (token: Omit<TokenAction, 'id'>) => Promise<void>;
  onDeleteToken: (date: string, actorSteamId: string, tokenType: string) => Promise<void>;
  user: SessionUser | null;
}) {
  const [tokenType, setTokenType] = useState<TokenAction['tokenType']>('delete_worst');
  const [actorSteamId, setActorSteamId] = useState('');
  const [targetSteamId, setTargetSteamId] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const allPlayers = useMemo(() => {
    const list: Array<{ steamId: string; name: string; leagueId: string }> = [];
    for (const league of config.leagues) {
      for (const steamId of league.players) {
        list.push({
          steamId,
          name: displayNameForSteamId(steamId, playersIndex),
          leagueId: league.id,
        });
      }
    }
    return list;
  }, [config, playersIndex]);

  const targetPlayers = useMemo(() => {
    if (tokenType === 'delete_worst' || tokenType === 'protect_best') {
      return actorSteamId ? allPlayers.filter((p) => p.steamId === actorSteamId) : [];
    }
    if (tokenType === 'lock_best') {
      const actorLeague = getPlayerLeague(actorSteamId, config);
      return allPlayers.filter((p) => p.leagueId === actorLeague && p.steamId !== actorSteamId);
    }
    return allPlayers;
  }, [actorSteamId, allPlayers, config, tokenType]);

  const tokenBudget = useMemo(() => {
    const datesSet = new Set(datesIncluded);
    const captainCounts = computeCaptainTokens(captainsByDate, datesSet);
    const usedCounts: Record<string, number> = {};

    if (tokensByDate) {
      for (const actions of Object.values(tokensByDate)) {
        for (const action of actions) {
          usedCounts[action.actorSteamId] = (usedCounts[action.actorSteamId] || 0) + 1;
        }
      }
    }

    return { captainCounts, usedCounts };
  }, [captainsByDate, datesIncluded, tokensByDate]);

  const allTokens = useMemo(() => {
    const list: TokenAction[] = [];
    if (!tokensByDate) return list;

    for (const actions of Object.values(tokensByDate)) {
      for (const action of actions) {
        list.push(action);
      }
    }

    return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [tokensByDate]);

  useEffect(() => {
    if (tokenType === 'delete_worst' || tokenType === 'protect_best') {
      setTargetSteamId(actorSteamId);
    }
  }, [actorSteamId, tokenType]);

  const handleSubmit = async () => {
    if (!date || !actorSteamId || !targetSteamId || !tokenType) {
      setMsg('Tüm alanları doldurun.');
      return;
    }

    const earned = tokenBudget.captainCounts[actorSteamId] || 0;
    const used = tokenBudget.usedCounts[actorSteamId] || 0;
    if (used >= earned) {
      setMsg(`${displayNameForSteamId(actorSteamId, playersIndex)} için token hakkı kalmadı (${used}/${earned}).`);
      return;
    }

    if (!user) {
      setMsg('Giriş yapmanız gerekiyor.');
      return;
    }

    const password = window.prompt('Token kaydetmek için şifre girin:');
    if (password !== CLEAR_ATTENDANCE_PASSWORD) {
      setMsg('Hatalı şifre.');
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await onSubmitToken({ date, actorSteamId, targetSteamId, tokenType, setAt: Date.now() });
      setMsg('Token kaydedildi.');
      setDate('');
      setActorSteamId('');
      setTargetSteamId('');
    } catch (error: unknown) {
      setMsg(`Hata: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <p className="text-sm text-gray-700">Token yönetimi için giriş yapmalısınız.</p>
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <h4 className="mb-4 font-semibold text-gray-800">Token Yönetimi (Admin)</h4>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs text-gray-600">Token Tipi</label>
          <select
            value={tokenType}
            onChange={(e) => setTokenType(e.target.value as TokenAction['tokenType'])}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          >
            <option value="delete_worst">Sil (En Kötü Gece)</option>
            <option value="lock_best">Kitle (Rakip En İyi)</option>
            <option value="protect_best">Koru (Kendi En İyi)</option>
            <option value="unlock">Kilit Aç</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-600">Kullanan Oyuncu</label>
          <select
            value={actorSteamId}
            onChange={(e) => setActorSteamId(e.target.value)}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          >
            <option value="">Seçin...</option>
            {allPlayers.map((player) => {
              const earned = tokenBudget.captainCounts[player.steamId] || 0;
              const used = tokenBudget.usedCounts[player.steamId] || 0;
              const remaining = Math.max(0, earned - used);
              return (
                <option key={player.steamId} value={player.steamId}>
                  {player.name} ({player.leagueId}) [{remaining} token]
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-600">Hedef Oyuncu</label>
          <select
            value={targetSteamId}
            onChange={(e) => setTargetSteamId(e.target.value)}
            disabled={tokenType === 'delete_worst' || tokenType === 'protect_best'}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">Seçin...</option>
            {targetPlayers.map((player) => (
              <option key={player.steamId} value={player.steamId}>
                {player.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-600">Uygulanan Gece</label>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          >
            <option value="">Seçin...</option>
            {datesIncluded.map((nightDate) => (
              <option key={nightDate} value={nightDate}>{nightDate}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="w-full rounded bg-purple-600 px-3 py-1.5 text-sm text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.startsWith('Hata') ? 'text-red-600' : 'text-green-600'}`}>
          {msg}
        </p>
      )}

      {allTokens.length > 0 && (
        <div className="mt-4">
          <h5 className="mb-2 text-sm font-medium text-gray-700">Kayıtlı Tokenlar ({allTokens.length})</h5>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {allTokens.map((token, index) => (
              <div key={`${token.actorSteamId}-${token.tokenType}-${token.date}-${index}`} className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm">
                <div className="flex items-center gap-2">
                  <TokenBadge type={token.tokenType} />
                  <span className="font-medium">{displayNameForSteamId(token.actorSteamId, playersIndex)}</span>
                  {token.actorSteamId !== token.targetSteamId && (
                    <>
                      <span className="text-gray-400">→</span>
                      <span>{displayNameForSteamId(token.targetSteamId, playersIndex)}</span>
                    </>
                  )}
                  <span className="text-xs text-gray-400">{token.date}</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const password = window.prompt('Silmek için şifre girin:');
                    if (password !== CLEAR_ATTENDANCE_PASSWORD) return;
                    await onDeleteToken(token.date, token.actorSteamId, token.tokenType);
                  }}
                  className="text-xs text-red-400 hover:text-red-600"
                  title="Sil"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TokenWarsClient({
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
  config: TokenWarsConfig | null;
}) {
  const { user } = useSession();

  const effectiveConfig: TokenWarsConfig = useMemo(() => {
    return config || {
      version: 1,
      scoring: {
        useStat: 'HLTV2 DIFF',
        performancePoints: [],
        teamPoints: { '2-0W': 60, '2-1W': 50, '1-1D': 30, '1-2L': 20, '0-2L': 10 },
        tokenTypes: [],
      },
      leagues: [],
    };
  }, [config]);

  const playersIndex = useMemo(() => buildPlayersIndex(players), [players]);

  const { data: captainsData, refetch: refetchCaptains } = useLivePolling<{ captainsByDate: CaptainsByDateSnapshot }>({
    url: '/api/live/batak-captains',
    intervalMs: 5000,
    initialData: { captainsByDate: {} },
  });
  const captainsByDate = captainsData.captainsByDate || null;

  const { data: tokensData, refetch: refetchTokens } = useLivePolling<{ tokensByDate: TokensByDateSnapshot }>({
    url: '/api/live/token-wars',
    intervalMs: 5000,
    initialData: { tokensByDate: {} },
  });
  const tokensByDate = tokensData.tokensByDate || null;

  const availableDates = useMemo(() => {
    const dates = Object.keys(nightAvg || {});
    const filtered = seasonStart ? dates.filter((date) => date >= seasonStart) : dates;
    return sortDatesDesc(filtered);
  }, [nightAvg, seasonStart]);

  const [selectedDate, setSelectedDate] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('standings');
  const [selectedProgressIndex, setSelectedProgressIndex] = useState<number | null>(null);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [captainSteamIds, setCaptainSteamIds] = useState<Record<TeamKey, string>>({ team1: '', team2: '' });
  const [savedCaptains, setSavedCaptains] = useState<Record<TeamKey, CaptainRecord | null>>({ team1: null, team2: null });
  const [savingTeam, setSavingTeam] = useState<Record<TeamKey, boolean>>({ team1: false, team2: false });
  const [message, setMessage] = useState<string | null>(null);

  const teams = useMemo(() => {
    if (!selectedDate) return null;
    return deriveTeamsForDate(sonmacByDate || {}, selectedDate);
  }, [selectedDate, sonmacByDate]);

  const standingsData = useMemo(() => {
    return computeTokenWarsStandings({
      config: effectiveConfig,
      nightAvg,
      sonmacByDate,
      captainsByDate,
      tokensByDate,
      seasonStart,
      playersIndex,
    });
  }, [captainsByDate, effectiveConfig, nightAvg, playersIndex, seasonStart, sonmacByDate, tokensByDate]);

  const totalPlayedNights = standingsData?.datesIncluded?.length ?? 0;
  const effectiveProgressIndex = selectedProgressIndex === null ? null : Math.min(selectedProgressIndex, totalPlayedNights);

  const filteredStandingsData = useMemo(() => {
    if (effectiveProgressIndex === null || effectiveProgressIndex >= totalPlayedNights) return standingsData;
    return computeTokenWarsStandings({
      config: effectiveConfig,
      nightAvg,
      sonmacByDate,
      captainsByDate,
      tokensByDate,
      seasonStart,
      playersIndex,
      upToNight: effectiveProgressIndex,
    });
  }, [captainsByDate, effectiveConfig, effectiveProgressIndex, nightAvg, playersIndex, seasonStart, sonmacByDate, standingsData, tokensByDate, totalPlayedNights]);

  const previousStandingsData = useMemo(() => {
    const currentNightCount = effectiveProgressIndex ?? totalPlayedNights;
    if (currentNightCount <= 1) return null;

    return computeTokenWarsStandings({
      config: effectiveConfig,
      nightAvg,
      sonmacByDate,
      captainsByDate,
      tokensByDate,
      seasonStart,
      playersIndex,
      upToNight: currentNightCount - 1,
    });
  }, [captainsByDate, effectiveConfig, effectiveProgressIndex, nightAvg, playersIndex, seasonStart, sonmacByDate, tokensByDate, totalPlayedNights]);

  const standingsWithChange = useMemo(() => {
    if (!filteredStandingsData?.byLeague) return null;

    const result: Record<string, { id: string; name: string; standings: TokenWarsPlayerStanding[] }> = {};
    for (const [leagueId, leagueData] of Object.entries(filteredStandingsData.byLeague)) {
      const prevLeague = previousStandingsData?.byLeague?.[leagueId];
      const prevMap = new Map<string, number>();
      prevLeague?.standings?.forEach((player, idx) => prevMap.set(player.steamId, idx));

      result[leagueId] = {
        ...leagueData,
        standings: leagueData.standings.map((player, idx) => {
          const prevIdx = prevMap.get(player.steamId);
          let positionChange: TokenWarsPlayerStanding['positionChange'] = 'new';
          if (prevIdx !== undefined) {
            positionChange = idx < prevIdx ? 'up' : idx > prevIdx ? 'down' : 'same';
          }
          return { ...player, positionChange };
        }),
      };
    }
    return result;
  }, [filteredStandingsData, previousStandingsData]);

  useEffect(() => {
    if (!selectedDate && availableDates.length) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  useEffect(() => {
    setMessage(null);
    setCaptainSteamIds({ team1: '', team2: '' });

    if (!selectedDate || !captainsByDate) {
      setSavedCaptains({ team1: null, team2: null });
      return;
    }

    const dateData = captainsByDate[selectedDate];
    setSavedCaptains({ team1: dateData?.team1 || null, team2: dateData?.team2 || null });
    setCaptainSteamIds({
      team1: dateData?.team1?.steamId || '',
      team2: dateData?.team2?.steamId || '',
    });
  }, [captainsByDate, selectedDate]);

  const handleSaveTeamCaptain = async (teamKey: TeamKey) => {
    if (!user) {
      setMessage('Giriş gerekli.');
      return;
    }
    if (!selectedDate || !teams) {
      setMessage('Tarih veya takım verisi yok.');
      return;
    }

    const roster = teamKey === 'team1' ? teams.team1Players : teams.team2Players;
    const teamName = teamKey === 'team1' ? teams.team1Name : teams.team2Name;
    const chosenSteamId = captainSteamIds[teamKey];

    if (!chosenSteamId || !roster.some((player) => player.steamId === chosenSteamId)) {
      setMessage('Kaptan takım kadrosunda olmalı.');
      return;
    }

    const password = window.prompt('Şifre girin:');
    if (password !== CLEAR_ATTENDANCE_PASSWORD) {
      setMessage('Hatalı şifre.');
      return;
    }

    setSavingTeam((state) => ({ ...state, [teamKey]: true }));
    try {
      await setCaptain({
        date: selectedDate,
        teamKey,
        steamId: chosenSteamId,
        steamName: displayNameForSteamId(chosenSteamId, playersIndex),
        teamName,
        setByUid: user.uid,
        setByName: user.name || user.email || '',
        setAt: Date.now(),
      });
      setMessage(`${teamName} kaptanı kaydedildi.`);
      await refetchCaptains();
    } catch (error: unknown) {
      setMessage(`Hata: ${getErrorMessage(error)}`);
    } finally {
      setSavingTeam((state) => ({ ...state, [teamKey]: false }));
    }
  };

  const handleSubmitToken = async (token: Omit<TokenAction, 'id'>) => {
    await setTokenWarsAction(token);
    await refetchTokens();
  };

  const handleDeleteToken = async (date: string, actorSteamId: string, tokenType: string) => {
    await deleteTokenWarsAction({ date, actorSteamId, tokenType });
    await refetchTokens();
  };

  const rawDates = standingsData?.datesIncluded || [];

  return (
    <div className="space-y-4">
      <ScoringReference config={effectiveConfig} />

      <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200 pb-1">
        {[
          { key: 'standings', label: 'Puan Durumu' },
          { key: 'raw', label: 'Ham Veri' },
          { key: 'kaptanlik', label: 'Kaptan Atama' },
          { key: 'tokens', label: 'Token Yönetimi' },
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
        <div className="space-y-4">
          <div className="rounded border p-3">
            {totalPlayedNights > 0 && (
              <SeasonProgressBar
                played={totalPlayedNights}
                total={SEASON_LENGTH}
                selectedIndex={selectedProgressIndex}
                onSelectIndex={setSelectedProgressIndex}
                dates={standingsData?.datesIncluded || []}
              />
            )}

            {(effectiveConfig.leagues || []).length === 0 ? (
              <div className="text-sm text-gray-700">Ligler tanımlı değil.</div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {effectiveConfig.leagues.map((league) => {
                  const block = standingsWithChange?.[league.id];
                  const rows = block?.standings || [];

                  return (
                    <div key={league.id} className="rounded border p-3">
                      <div className="mb-2 text-base font-semibold text-gray-800">{league.name}</div>
                      <div className="overflow-x-auto rounded border">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-200">
                            <tr>
                              <th className="w-8 px-1 py-2 text-center font-semibold text-gray-800" title="Pozisyon değişimi">
                                <BarChart3 className="mx-auto h-4 w-4" />
                              </th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-800">Oyuncu</th>
                              <th className="hidden px-1 py-2 text-center font-semibold text-gray-800 sm:table-cell" title="5 maç + 1 kaptanlık">5m/1k</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-800">Oyn.</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-800">Kpt.</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-800">Token</th>
                              <th className="px-2 py-2 text-right font-semibold text-gray-800">Puan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((player, idx) => {
                              const isTop = idx === 0;
                              const isBottom = idx === rows.length - 1 && !isTop;
                              const isExpanded = expandedPlayer === player.steamId;
                              const rowClass = isExpanded ? 'bg-blue-50' : isTop ? 'bg-green-50' : isBottom ? 'bg-red-50' : '';

                              return (
                                <React.Fragment key={player.steamId}>
                                  <tr
                                    className={`cursor-pointer border-t hover:bg-gray-50 ${rowClass}`}
                                    onClick={() => setExpandedPlayer(isExpanded ? null : player.steamId)}
                                  >
                                    <td className="px-1 py-2 text-center"><PositionChangeIndicator change={player.positionChange} /></td>
                                    <td className="max-w-[100px] truncate px-2 py-2 font-medium text-sm sm:max-w-none">{player.name}</td>
                                    <td className="hidden px-1 py-2 text-center sm:table-cell"><KriteriaMet met={player.meetsKriteria} /></td>
                                    <td className="px-2 py-2 text-right">{player.oyn}</td>
                                    <td className="px-2 py-2 text-right">{player.kpt}</td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">{player.tokensUsed}/{player.kpt}</td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">{formatNumber(player.totalPoints)}</td>
                                  </tr>
                                  {isExpanded && player.nightBreakdown.length > 0 && (
                                    <tr className="border-t bg-gray-50">
                                      <td colSpan={7} className="px-3 py-2">
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-xs">
                                            <thead className="text-gray-500">
                                              <tr>
                                                <th className="px-2 py-1 text-left">Tarih</th>
                                                <th className="px-2 py-1 text-right">HLTV2 DIFF</th>
                                                <th className="px-2 py-1 text-right">Perf.</th>
                                                <th className="px-2 py-1 text-right">Takım</th>
                                                <th className="px-2 py-1 text-right">Toplam</th>
                                                <th className="px-2 py-1 text-center">Durum</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {player.nightBreakdown.map((entry) => (
                                                <tr key={entry.date} className={`border-t ${entry.deleted || entry.locked ? 'opacity-60' : ''}`}>
                                                  <td className="px-2 py-1 text-gray-600">{entry.date}</td>
                                                  <td className={`px-2 py-1 text-right ${entry.hltv2Diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {entry.hltv2Diff >= 0 ? '+' : ''}{entry.hltv2Diff.toFixed(2)}
                                                  </td>
                                                  <td className="px-2 py-1 text-right">{entry.perfPoints}</td>
                                                  <td className="px-2 py-1 text-right">{entry.teamPoints}</td>
                                                  <td className="px-2 py-1 text-right font-medium">{entry.totalPoints}</td>
                                                  <td className="px-2 py-1 text-center"><NightStateBadges entry={entry} /></td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
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

      {activeTab === 'raw' && (
        <div className="rounded border p-3">
          {rawDates.length === 0 ? (
            <div className="text-sm text-gray-500">Henüz veri yok.</div>
          ) : (
            <div className="space-y-4">
              {(effectiveConfig.leagues || []).map((league) => {
                const rows = standingsData?.byLeague?.[league.id]?.standings || [];

                return (
                  <div key={league.id} className="rounded border p-3">
                    <div className="mb-2 text-base font-semibold text-gray-800">{league.name}</div>
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
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((player) => {
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
                                    <td key={date} className={`px-3 py-2 text-center ${getNightStateTone(entry)}`}>
                                      <div className={`font-mono ${entry.hltv2Diff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                        {entry.hltv2Diff >= 0 ? '+' : ''}{entry.hltv2Diff.toFixed(2)}
                                      </div>
                                      <div className="text-[10px] font-mono text-gray-600">
                                        Takım {entry.teamPoints >= 0 ? '+' : ''}{entry.teamPoints}
                                      </div>
                                      <NightStateBadges entry={entry} />
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
      )}

      {activeTab === 'kaptanlik' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Tarih:</label>
            <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="rounded border px-2 py-1 text-sm">
              {availableDates.map((date) => (
                <option key={date} value={date}>{date}</option>
              ))}
            </select>
          </div>

          {teams ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(['team1', 'team2'] as const).map((teamKey) => {
                const roster = teamKey === 'team1' ? teams.team1Players : teams.team2Players;
                const teamName = teamKey === 'team1' ? teams.team1Name : teams.team2Name;
                const saved = savedCaptains[teamKey];

                return (
                  <div key={teamKey} className="rounded-lg bg-white p-4 shadow">
                    <h4 className="text-sm font-semibold">{teamName}</h4>
                    {saved ? (
                      <p className="mt-2 text-sm text-green-700">
                        Kaptan: <span className="font-medium">{displayNameForSteamId(saved.steamId, playersIndex)}</span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">Kaptan atanmadı</p>
                    )}
                    <select
                      value={captainSteamIds[teamKey]}
                      onChange={(e) => setCaptainSteamIds((state) => ({ ...state, [teamKey]: e.target.value }))}
                      className="mt-2 w-full rounded border px-2 py-1 text-sm"
                    >
                      <option value="">Seçin...</option>
                      {roster.map((player) => (
                        <option key={player.steamId} value={player.steamId}>{displayNameForSteamId(player.steamId, playersIndex)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleSaveTeamCaptain(teamKey)}
                      disabled={savingTeam[teamKey]}
                      className="mt-2 rounded bg-purple-600 px-3 py-1 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
                    >
                      {savingTeam[teamKey] ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{selectedDate ? 'Bu tarih için takım verisi yok.' : 'Bir tarih seçin.'}</p>
          )}

          {message && <p className="text-sm text-amber-600">{message}</p>}
        </div>
      )}

      {activeTab === 'tokens' && (
        <AdminTokenPanel
          config={effectiveConfig}
          captainsByDate={captainsByDate}
          tokensByDate={tokensByDate}
          datesIncluded={standingsData?.datesIncluded || []}
          playersIndex={playersIndex}
          onSubmitToken={handleSubmitToken}
          onDeleteToken={handleDeleteToken}
          user={user}
        />
      )}
    </div>
  );
}

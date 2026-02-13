'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { db } from '@/lib/firebase';
import { off, onValue, ref, set } from 'firebase/database';
import { buildPlayersIndex, displayNameForSteamId } from '@/lib/batakAllStars';
import { Trophy } from 'lucide-react';

const CLEAR_ATTENDANCE_PASSWORD = process.env.NEXT_PUBLIC_CLEAR_ATTENDANCE_PASSWORD || 'osirikler';

interface PlayerRow {
  steam_id: string;
  name: string;
  [key: string]: any;
}

interface NightAvgData {
  [date: string]: PlayerRow[];
}

interface VoteData {
  [voterSteamId: string]: string; // voter -> voted_for
}

interface VotesByDate {
  [date: string]: VoteData;
}

type LockedByDateSnapshot = Record<
  string,
  | {
      locked: true;
      lockedAt?: number;
      lockedByUid?: string;
      lockedByName?: string;
    }
  | null
  | true
>;

interface VoteCount {
  steamId: string;
  name: string;
  count: number;
}

interface HistoricalResult {
  date: string;
  winners: { steamId: string; name: string; count: number }[];
  totalVotes: number;
  totalPlayers: number;
}

function sortDatesDesc(dates: string[]): string[] {
  return [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export default function GecenInMVPsiClient({
  nightAvg,
  players,
  seasonStart,
}: {
  nightAvg: NightAvgData;
  players: any[];
  seasonStart: string | null;
}) {
  const { user } = useAuth();
  const { isDark } = useTheme();

  const availableDates = useMemo(() => {
    const dates = Object.keys(nightAvg || {});
    const filtered = seasonStart ? dates.filter((d) => d >= seasonStart) : dates;
    return sortDatesDesc(filtered);
  }, [nightAvg, seasonStart]);

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [votesByDate, setVotesByDate] = useState<VotesByDate>({});
  const [lockedByDate, setLockedByDate] = useState<LockedByDateSnapshot>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const playersIndex = useMemo(() => buildPlayersIndex(players), [players]);

  // Get players who played on the selected night
  const nightPlayers = useMemo(() => {
    if (!selectedDate || !nightAvg[selectedDate]) return [];
    return nightAvg[selectedDate].map((p) => ({
      steamId: p.steam_id,
      name: (() => {
        const canonical = displayNameForSteamId(p.steam_id, playersIndex);
        if (canonical && canonical !== p.steam_id) return canonical;
        return p.name || 'Unknown';
      })(),
    }));
  }, [nightAvg, selectedDate, playersIndex]);

  // Default date selection
  useEffect(() => {
    if (!selectedDate && availableDates.length) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  // Listen to all votes from Firebase
  useEffect(() => {
    const baseRef = ref(db, 'mvpVotes/votesByDate');
    const unsub = onValue(
      baseRef,
      (snap) => {
        const val = (snap.val() || {}) as VotesByDate;
        setVotesByDate(val);
      },
      () => {
        // ignore errors
      }
    );
    return () => off(baseRef, 'value', unsub);
  }, []);

  // Listen to locked dates from Firebase
  useEffect(() => {
    const baseRef = ref(db, 'mvpVotes/lockedByDate');
    const unsub = onValue(
      baseRef,
      (snap) => {
        const val = (snap.val() || {}) as LockedByDateSnapshot;
        setLockedByDate(val);
      },
      () => {
        // ignore errors
      }
    );
    return () => off(baseRef, 'value', unsub);
  }, []);

  const isDateLocked = useMemo(() => {
    if (!selectedDate) return false;
    const v = lockedByDate?.[selectedDate];
    if (v === true) return true;
    return !!(v && typeof v === 'object' && (v as any).locked);
  }, [lockedByDate, selectedDate]);

  // Calculate vote counts for selected date
  const voteCounts = useMemo((): VoteCount[] => {
    if (!selectedDate || !votesByDate[selectedDate]) return [];

    const votes = votesByDate[selectedDate];
    const counts = new Map<string, number>();

    // Count votes
    Object.values(votes).forEach((votedForId) => {
      counts.set(votedForId, (counts.get(votedForId) || 0) + 1);
    });

    // Convert to array with names
    const result: VoteCount[] = [];
    counts.forEach((count, steamId) => {
      const playerData = nightPlayers.find((p) => p.steamId === steamId);
      result.push({
        steamId,
        name: (() => {
          const canonical = displayNameForSteamId(steamId, playersIndex);
          if (canonical && canonical !== steamId) return canonical;
          return playerData?.name || 'Unknown';
        })(),
        count,
      });
    });

    // Sort by count descending
    return result.sort((a, b) => b.count - a.count);
  }, [selectedDate, votesByDate, nightPlayers, playersIndex]);

  // Get winners (players with highest vote count)
  const winners = useMemo(() => {
    if (voteCounts.length === 0) return [];
    const maxCount = voteCounts[0].count;
    return voteCounts.filter((v) => v.count === maxCount);
  }, [voteCounts]);

  // Calculate historical results for all dates
  const historicalResults = useMemo((): HistoricalResult[] => {
    const results: HistoricalResult[] = [];

    availableDates.forEach((date) => {
      const votes = votesByDate[date];
      if (!votes) return;

      const counts = new Map<string, number>();
      Object.values(votes).forEach((votedForId) => {
        counts.set(votedForId, (counts.get(votedForId) || 0) + 1);
      });

      if (counts.size === 0) return;

      const dateNightPlayers = nightAvg[date] || [];
      const voteCountsArray: VoteCount[] = [];
      counts.forEach((count, steamId) => {
        const playerData = dateNightPlayers.find((p: PlayerRow) => p.steam_id === steamId);
        voteCountsArray.push({
          steamId,
          name: (() => {
            const canonical = displayNameForSteamId(steamId, playersIndex);
            if (canonical && canonical !== steamId) return canonical;
            return playerData?.name || 'Unknown';
          })(),
          count,
        });
      });

      voteCountsArray.sort((a, b) => b.count - a.count);
      const maxCount = voteCountsArray[0]?.count || 0;
      const dateWinners = voteCountsArray.filter((v) => v.count === maxCount);

      results.push({
        date,
        winners: dateWinners,
        totalVotes: Object.keys(votes).length,
        totalPlayers: dateNightPlayers.length,
      });
    });

    return results;
  }, [availableDates, votesByDate, nightAvg, playersIndex]);

  // Handle vote submission
  const handleVote = async (voterSteamId: string, votedForSteamId: string) => {
    if (!user) {
      setMessage('Giriş gerekli.');
      return;
    }

    if (!selectedDate) {
      setMessage('Bir tarih seçin.');
      return;
    }

    if (isDateLocked) {
      setMessage('Bu tarih kilitli. Oylar değiştirilemez.');
      return;
    }

    if (voterSteamId === votedForSteamId) {
      setMessage('Kendinize oy veremezsiniz!');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const voteRef = ref(db, `mvpVotes/votesByDate/${selectedDate}/${voterSteamId}`);
      await set(voteRef, votedForSteamId);
      setMessage('Oy kaydedildi!');
      setTimeout(() => setMessage(null), 2000);
    } catch (error) {
      console.error('Vote save error:', error);
      setMessage('Oy kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const currentVotes = votesByDate[selectedDate] || {};

  const handleToggleLock = async (date: string, shouldLock: boolean) => {
    if (!user) {
      setMessage('Giriş gerekli.');
      return;
    }

    const promptText = shouldLock
      ? 'Kaydetmek (kilitlemek) için şifre girin:'
      : 'Değiştirmek (kilidi açmak) için şifre girin:';

    const password = window.prompt(promptText);
    if (password === null) return;
    if (password !== CLEAR_ATTENDANCE_PASSWORD) {
      setMessage('Hatalı şifre.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const lockRef = ref(db, `mvpVotes/lockedByDate/${date}`);
      if (shouldLock) {
        await set(lockRef, {
          locked: true,
          lockedAt: Date.now(),
          lockedByUid: user.uid,
          lockedByName: user.displayName || user.email || undefined,
        });

        try {
          const winnerSummary =
            winners.length > 0
              ? winners.map((w) => `${w.name} (${w.count} oy)`).join(" & ")
              : "Sonuç hesaplanamadı";
          const idToken = await user.getIdToken();
          await fetch('/api/notifications/emit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              topic: 'mvp_poll_locked',
              eventId: `mvp_poll_locked:${date}`,
              title: "🏆 Gecenin MVP'si belirlendi",
              body: `🏆 ${winnerSummary}`,
              data: {
                date,
                winnerSummary,
                winnerCount: winners.length,
                topVoteCount: winners[0]?.count || 0,
                link: "/gecenin-mvpsi",
              },
            }),
          });
        } catch (notifyError) {
          console.warn('Failed to emit MVP lock notification event', notifyError);
        }

        setMessage('Kaydedildi ve kilitlendi.');
      } else {
        // Setting null removes the node in Realtime Database
        await set(lockRef, null);
        setMessage('Kilit kaldırıldı.');
      }
      setTimeout(() => setMessage(null), 2000);
    } catch (error) {
      console.error('Lock toggle error:', error);
      setMessage('İşlem başarısız.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      <div className="mb-4">
        <label htmlFor="date-select" className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : ''}`}>
          Tarih Seç:
        </label>
        <select
          id="date-select"
          className={`border rounded px-3 py-2 ${isDark ? 'bg-dark-card border-dark-border text-gray-100' : ''}`}
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        >
          {availableDates.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded ${isDark ? 'bg-blue-900/30 border border-blue-500/30 text-blue-300' : 'bg-blue-100 border border-blue-400 text-blue-700'}`}>
          {message}
        </div>
      )}

      {/* Current Night Voting */}
      {selectedDate && (
        <div>
          <h3 className="text-xl font-semibold mb-4">
            {selectedDate} - Oylama
          </h3>

          {isDateLocked && (
            <div className={`px-4 py-3 rounded mb-4 ${isDark ? 'bg-dark-card border border-dark-border text-gray-400' : 'bg-gray-100 border border-gray-300 text-gray-700'}`}>
              Bu tarih kilitli. Oylar değiştirilemez.
            </div>
          )}

          {/* Winners Display */}
          {winners.length > 0 && (
            <div className={`rounded-lg p-4 mb-4 ${isDark ? 'bg-yellow-900/20 border-2 border-yellow-500/40' : 'bg-yellow-50 border-2 border-yellow-400'}`}>
              <h4 className={`text-lg font-bold mb-2 flex items-center gap-2 ${isDark ? 'text-yellow-400' : 'text-yellow-800'}`}>
                <Trophy className="w-5 h-5" /> Gecenin MVP&apos;si:
              </h4>
              <div className={`text-2xl font-bold ${isDark ? 'text-yellow-300' : 'text-yellow-900'}`}>
                {winners.map((w, i) => (
                  <span key={w.steamId}>
                    {i > 0 && ' & '}
                    {w.name} ({w.count} oy)
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Voting Table */}
          <div className="overflow-x-auto">
            <table className={`min-w-full border-collapse border ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
              <thead>
                <tr className={isDark ? 'bg-dark-surface' : 'bg-gray-200'}>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Oyuncu</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Oy Ver</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Verdiği Oy</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Aldığı Oy Sayısı</th>
                </tr>
              </thead>
              <tbody>
                {nightPlayers.map((player) => {
                  const voterChoice = currentVotes[player.steamId] || '';
                  const votedForName = voterChoice
                    ? nightPlayers.find((p) => p.steamId === voterChoice)?.name || 'Unknown'
                    : '-';
                  const receivedCount =
                    voteCounts.find((v) => v.steamId === player.steamId)?.count || 0;

                  return (
                    <tr key={player.steamId} className={isDark ? 'hover:bg-[#1a2340]/50' : ''}>
                      <td className={`border px-4 py-2 font-semibold ${isDark ? 'border-dark-border text-gray-200' : 'border-gray-300'}`}>
                        {player.name}
                      </td>
                      <td className={`border px-4 py-2 ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
                        <select
                          className={`border rounded px-2 py-1 w-full ${isDark ? 'bg-dark-card border-dark-border text-gray-100' : ''}`}
                          value={voterChoice}
                          onChange={(e) => handleVote(player.steamId, e.target.value)}
                          disabled={saving || isDateLocked}
                        >
                          <option value="">-- Seç --</option>
                          {nightPlayers
                            .filter((p) => p.steamId !== player.steamId)
                            .map((p) => (
                              <option key={p.steamId} value={p.steamId}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className={`border px-4 py-2 text-center ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>
                        {votedForName}
                      </td>
                      <td className={`border px-4 py-2 text-center ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>
                        {receivedCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Vote Summary */}
          {voteCounts.length > 0 && (
            <div className="mt-4">
              <h4 className="text-lg font-semibold mb-2">Oy Dağılımı:</h4>
              <div className="space-y-1">
                {voteCounts.map((vc, idx) => (
                  <div key={vc.steamId} className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>#{idx + 1}</span>
                    <span className="font-semibold">{vc.name}</span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>- {vc.count} oy</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Historical Results */}
      <div className="mt-8">
        <h3 className="text-xl font-semibold mb-4">Geçmiş MVP'ler</h3>
        {historicalResults.length === 0 && (
          <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>Henüz oy kullanılmamış.</p>
        )}
        {historicalResults.length > 0 && (
          <div className="overflow-x-auto">
            <table className={`min-w-full border-collapse border ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
              <thead>
                <tr className={isDark ? 'bg-dark-surface' : 'bg-gray-200'}>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Tarih</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>MVP</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Oy Sayısı</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>Toplam Oy / Oyuncu</th>
                  <th className={`border px-4 py-2 ${isDark ? 'border-dark-border text-gray-300' : 'border-gray-300'}`}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {historicalResults.map((result) => (
                  <tr
                    key={result.date}
                    className={
                      (() => {
                        const v = lockedByDate?.[result.date];
                        const locked = v === true || !!(v && typeof v === 'object' && (v as any).locked);
                        if (isDark) return locked ? 'bg-dark-surface text-gray-500' : '';
                        return locked ? 'bg-gray-100 text-gray-500' : '';
                      })()
                    }
                  >
                    <td className={`border px-4 py-2 ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>{result.date}</td>
                    <td className={`border px-4 py-2 font-semibold ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
                      {result.winners.map((w, i) => (
                        <span key={w.steamId}>
                          {i > 0 && ' & '}
                          {w.name}
                        </span>
                      ))}
                    </td>
                    <td className={`border px-4 py-2 text-center ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
                      {result.winners[0]?.count || 0}
                    </td>
                    <td className={`border px-4 py-2 text-center ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
                      {result.totalVotes} / {result.totalPlayers}
                    </td>
                    <td className={`border px-4 py-2 text-center ${isDark ? 'border-dark-border' : 'border-gray-300'}`}>
                      {(() => {
                        const v = lockedByDate?.[result.date];
                        const locked = v === true || !!(v && typeof v === 'object' && (v as any).locked);
                        const label = locked ? 'Değiştir' : 'Kaydet';
                        return (
                          <button
                            className={`px-3 py-1 rounded text-sm font-medium ${locked ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-blue-600 text-white hover:bg-blue-700'} transition-colors`}
                            onClick={() => handleToggleLock(result.date, !locked)}
                            disabled={saving}
                          >
                            {label}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

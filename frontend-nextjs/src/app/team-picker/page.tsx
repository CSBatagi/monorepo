'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Player } from '@/types';
import { db } from '@/lib/firebase';
import { ref, onValue, off, set } from 'firebase/database';

const ATTENDANCE_DB_PATH = 'attendanceState';
const TEAM_PICKER_DB_PATH = 'teamPickerState';

interface FirebaseAttendanceData {
  [steamId: string]: { name?: string; status: string; };
}

interface TeamPlayerData {
    [steamId: string]: Player; // Keyed by steamId, value is Player object
}

// Add a stat formatting helper
function formatStat(value: number | null | undefined, decimals: number = 2) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return decimals === 0 ? Math.round(value) : value.toFixed(decimals);
}

// Add helper for team averages
function getTeamAverages(players: Player[]): Record<string, number | null> {
  const statsKeys = [
    'L10_HLTV2', 'L10_ADR', 'L10_KD', 'S_HLTV2', 'S_ADR', 'S_KD'
  ];
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  statsKeys.forEach(k => { sums[k] = 0; counts[k] = 0; });
  players.forEach(p => {
    statsKeys.forEach(k => {
      const v = p.stats?.[k as keyof typeof p.stats];
      if (typeof v === 'number' && !isNaN(v)) {
        sums[k] += v;
        counts[k]++;
      }
    });
  });
  const avgs: Record<string, number | null> = {};
  statsKeys.forEach(k => {
    avgs[k] = counts[k] > 0 ? sums[k] / counts[k] : null;
  });
  return avgs;
}

export default function TeamPickerPage() {
  const { user, loading: authLoading } = useAuth();
  const [teamAPlayers, setTeamAPlayers] = useState<TeamPlayerData>({});
  const [teamBPlayers, setTeamBPlayers] = useState<TeamPlayerData>({});

  const [loadingFirebaseData, setLoadingFirebaseData] = useState(true);
  const [loadingTeamA, setLoadingTeamA] = useState(true);
  const [loadingTeamB, setLoadingTeamB] = useState(true);

  const [last10Stats, setLast10Stats] = useState<any[]>([]);
  const [seasonStats, setSeasonStats] = useState<any[]>([]);
  const [firebaseAttendance, setFirebaseAttendance] = useState<FirebaseAttendanceData>({});

  console.log('[TeamPickerPage] Component Render - AuthLoading:', authLoading, 'User:', !!user);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const l10 = await fetch('/data/last10.json?_cb=' + Date.now());
        const l10Data = await l10.json();
        setLast10Stats(l10Data);
      } catch (e) { setLast10Stats([]); }
      try {
        const season = await fetch('/data/season_avg.json?_cb=' + Date.now());
        const seasonData = await season.json();
        setSeasonStats(seasonData);
      } catch (e) { setSeasonStats([]); }
    };
    fetchStats();
  }, []);

  useEffect(() => {
    if (!user) {
      setLoadingFirebaseData(false);
      setLoadingTeamA(false);
      setLoadingTeamB(false);
      console.log('[TeamPickerPage] No user, skipping Firebase listeners.');
      return;
    }
    console.log('[TeamPickerPage] User detected, setting up Firebase listeners.');

    setLoadingFirebaseData(true);
    const attendanceRef = ref(db, ATTENDANCE_DB_PATH);
    const onAttendanceValue = onValue(attendanceRef, (snapshot) => {
      const data = snapshot.val() || {};
      setFirebaseAttendance(data);
      console.log('[TeamPickerPage] Firebase attendance data received:', data);
      setLoadingFirebaseData(false);
    }, (error) => {
      console.error("[TeamPickerPage] Firebase attendance listener error:", error);
      setLoadingFirebaseData(false);
    });

    // Listeners for Team A and Team B players
    setLoadingTeamA(true);
    const teamARef = ref(db, `${TEAM_PICKER_DB_PATH}/teamA/players`);
    const onTeamAValue = onValue(teamARef, (snapshot) => {
        const data = snapshot.val() || {};
        setTeamAPlayers(data);
        console.log('[TeamPickerPage] Firebase Team A data received:', data);
        setLoadingTeamA(false);
    }, (error) => {
        console.error("[TeamPickerPage] Firebase Team A listener error:", error);
        setLoadingTeamA(false);
    });

    setLoadingTeamB(true);
    const teamBRef = ref(db, `${TEAM_PICKER_DB_PATH}/teamB/players`);
    const onTeamBValue = onValue(teamBRef, (snapshot) => {
        const data = snapshot.val() || {};
        setTeamBPlayers(data);
        console.log('[TeamPickerPage] Firebase Team B data received:', data);
        setLoadingTeamB(false);
    }, (error) => {
        console.error("[TeamPickerPage] Firebase Team B listener error:", error);
        setLoadingTeamB(false);
    });

    return () => {
      console.log('[TeamPickerPage] Cleaning up Firebase listeners.');
      off(attendanceRef, 'value', onAttendanceValue);
      off(teamARef, 'value', onTeamAValue);
      off(teamBRef, 'value', onTeamBValue);
    };
  }, [user]);

  const getStatsBySteamId = useCallback((steamId: string) => {
    const l10 = last10Stats.find((p) => p.steam_id === steamId);
    const season = seasonStats.find((p) => p.steam_id === steamId);
    return {
      L10_HLTV2: l10?.hltv_2 ?? null,
      L10_ADR: l10?.adr ?? null,
      L10_KD: l10?.kd ?? null,
      S_HLTV2: season?.hltv_2 ?? null,
      S_ADR: season?.adr ?? null,
      S_KD: season?.kd ?? null,
    };
  }, [last10Stats, seasonStats]);

  const availablePlayers = useMemo(() => {
    if (loadingFirebaseData || loadingTeamA || loadingTeamB) return [];
    return Object.entries(firebaseAttendance)
      .filter(([_, data]) => data.status === 'coming') // Include ALL coming players
      .map(([steamId, data]) => {
        return {
          steamId,
          name: data.name || 'Unknown Player',
          status: data.status,
          stats: getStatsBySteamId(steamId),
        };
      })
      .sort((a, b) => {
        const valueA = a.stats?.L10_HLTV2 ?? -Infinity;
        const valueB = b.stats?.L10_HLTV2 ?? -Infinity;
        return valueB - valueA; // Descending order (highest first)
      });
  }, [firebaseAttendance, teamAPlayers, teamBPlayers, loadingFirebaseData, loadingTeamA, loadingTeamB, getStatsBySteamId]);

  const handleAssignPlayer = useCallback(async (playerSteamId: string, targetTeam: 'A' | 'B') => {
    console.log(`[TeamPickerPage] Assigning player ${playerSteamId} to Team ${targetTeam}`);
    // Find the player in availablePlayers to get both name and stats
    const playerToAssign = availablePlayers.find(p => p.steamId === playerSteamId);

    if (!playerToAssign) {
      console.error(`[TeamPickerPage] Player ${playerSteamId} not found in availablePlayers. Cannot assign.`);
      return;
    }

    // Ensure player is not already in the other team
    const otherTeam = targetTeam === 'A' ? 'B' : 'A';
    const otherTeamPlayers = targetTeam === 'A' ? teamBPlayers : teamAPlayers;
    if (otherTeamPlayers[playerSteamId]) {
      // Remove from the other team first
      const otherTeamRef = ref(db, `${TEAM_PICKER_DB_PATH}/team${otherTeam}/players/${playerSteamId}`);
      try {
        await set(otherTeamRef, null);
        console.log(`[TeamPickerPage] Player ${playerSteamId} removed from Team ${otherTeam} before assigning to Team ${targetTeam}`);
      } catch (error) {
        console.error(`[TeamPickerPage] Error removing player ${playerSteamId} from Team ${otherTeam}:`, error);
        // Optionally, decide if you want to proceed or stop if removal fails
      }
    }

    const teamRef = ref(db, `${TEAM_PICKER_DB_PATH}/team${targetTeam}/players/${playerSteamId}`);
    try {
      await set(teamRef, playerToAssign); // Store the full player object with stats
      console.log(`[TeamPickerPage] Player ${playerToAssign.name} assigned to Team ${targetTeam} in Firebase.`);
    } catch (error) {
      console.error(`[TeamPickerPage] Error assigning player ${playerToAssign.name} to Team ${targetTeam}:`, error);
    }
  }, [availablePlayers, teamAPlayers, teamBPlayers]);

  const handleRemovePlayerFromTeam = useCallback(async (playerSteamId: string, targetTeam: 'A' | 'B') => {
    console.log(`[TeamPickerPage] Removing player ${playerSteamId} from Team ${targetTeam}`);
    const teamRef = ref(db, `${TEAM_PICKER_DB_PATH}/team${targetTeam}/players/${playerSteamId}`);
    try {
      await set(teamRef, null);
      console.log(`[TeamPickerPage] Player ${playerSteamId} removed from Team ${targetTeam} in Firebase.`);
    } catch (error) {
      console.error(`[TeamPickerPage] Error removing player ${playerSteamId} from Team ${targetTeam}:`, error);
    }
  }, []);

  const handleMarkNotComing = useCallback(async (playerSteamId: string) => {
    console.log(`[TeamPickerPage] Marking player ${playerSteamId} as not coming.`);
    const playerInTeamA = teamAPlayers[playerSteamId];
    const playerInTeamB = teamBPlayers[playerSteamId];

    // If player is in a team, remove them first
    if (playerInTeamA) {
      await handleRemovePlayerFromTeam(playerSteamId, 'A');
    }
    if (playerInTeamB) {
      await handleRemovePlayerFromTeam(playerSteamId, 'B');
    }

    const attendanceStatusRef = ref(db, `${ATTENDANCE_DB_PATH}/${playerSteamId}/status`);
    try {
      await set(attendanceStatusRef, 'not_coming'); // Or any other appropriate status
      console.log(`[TeamPickerPage] Player ${playerSteamId} status updated to not_coming in Firebase.`);
    } catch (error) {
      console.error(`[TeamPickerPage] Error updating player ${playerSteamId} status:`, error);
    }
  }, [teamAPlayers, teamBPlayers, handleRemovePlayerFromTeam]);

  console.log('[TeamPickerPage] Final availablePlayers for render:', availablePlayers);
  console.log('[TeamPickerPage] Final loading states for render - Auth:', authLoading, 'FirebaseData:', loadingFirebaseData, 'TeamA:', loadingTeamA, 'TeamB:', loadingTeamB);

  const isLoading = authLoading || loadingFirebaseData || loadingTeamA || loadingTeamB;
  // For the initial display of available players, we primarily care about firebaseAttendance and team lists being loaded.
  const isAvailablePlayersListLoading = loadingFirebaseData || loadingTeamA || loadingTeamB;

  if (authLoading) { // Changed to only authLoading for the very first check
    return <div className="text-center py-10">Authenticating...</div>;
  }

  if (!user) {
    return (
      <div className="text-center py-10">
        <p className="text-xl font-semibold text-gray-700">Please sign in to view the team selection page.</p>
      </div>
    );
  }
  
  // Table for available players
  const renderAvailablePlayersList = () => {
    if (isAvailablePlayersListLoading) {
      return <p className="text-sm text-gray-500">Loading available players and stats...</p>;
    }
    
    if (availablePlayers.length === 0) {
      return <p className="text-sm text-gray-500">No players are currently available.</p>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-0">
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '24%' }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-100 text-xs font-medium text-gray-600 uppercase">
              <th className="px-0.5 py-1 text-left">PLAYER</th>
              <th className="px-0.5 py-1 text-center">L10<br/>HLT</th>
              <th className="px-0.5 py-1 text-center">L10<br/>ADR</th>
              <th className="px-0.5 py-1 text-center">L10<br/>K/D</th>
              <th className="px-0.5 py-1 text-center">S<br/>HLT</th>
              <th className="px-0.5 py-1 text-center">S<br/>ADR</th>
              <th className="px-0.5 py-1 text-center">S<br/>K/D</th>
              <th className="px-0.5 py-1 text-center">TEAM</th>
              <th className="px-0.5 py-1 text-center">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {availablePlayers.map((player, idx) => {
              const assignedTeam = teamAPlayers[player.steamId]
                ? 'A'
                : teamBPlayers[player.steamId]
                ? 'B'
                : null;
              const isAssigned = !!assignedTeam;
              return (
                <tr
                  key={player.steamId}
                  className={`border-b border-gray-200 hover:bg-gray-50 ${isAssigned ? 'opacity-50 bg-gray-100' : idx % 2 === 1 ? 'bg-gray-50' : ''}`}
                >
                  <td className="px-0.5 py-1 font-medium text-gray-900 truncate">{player.name}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(player.stats?.L10_HLTV2, 2)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(player.stats?.L10_ADR, 0)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(player.stats?.L10_KD, 2)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(player.stats?.S_HLTV2, 2)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(player.stats?.S_ADR, 0)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(player.stats?.S_KD, 2)}</td>
                  <td className={`px-0.5 py-1 text-center font-medium ${assignedTeam === 'A' ? 'text-blue-600' : assignedTeam === 'B' ? 'text-green-600' : 'text-gray-500'}`}>{assignedTeam || '-'}</td>
                  <td className="px-0.5 py-1 text-center">
                    {isAssigned ? (
                      <button
                        className="text-xs text-red-500 hover:text-red-700 px-1 py-0.5 rounded"
                        onClick={() => handleRemovePlayerFromTeam(player.steamId, assignedTeam as 'A' | 'B')}
                      >
                        Remove
                      </button>
                    ) : (
                      <div className="flex gap-2 justify-center items-center">
                        <button
                          className="text-xs text-blue-500 hover:text-blue-700"
                          onClick={() => handleAssignPlayer(player.steamId, 'A')}
                        >
                          ➔<span className="font-bold">A</span>
                        </button>
                        <button
                          className="text-xs text-green-500 hover:text-green-700"
                          onClick={() => handleAssignPlayer(player.steamId, 'B')}
                        >
                          ➔<span className="font-bold">B</span>
                        </button>
                        <button
                          className="text-xs text-gray-500 hover:text-gray-700"
                          type="button"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Table for team lists
  const renderTeamList = (team: 'A' | 'B', players: TeamPlayerData, isLoadingTeam: boolean) => {
    const teamName = team === 'A' ? 'Team A' : 'Team B';
    const teamColor = team === 'A' ? 'blue' : 'green';
    const bgColor = team === 'A' ? 'bg-blue-100' : 'bg-green-100';
    const avgBgColor = team === 'A' ? 'bg-blue-200' : 'bg-green-200';
    const avgTextColor = team === 'A' ? 'text-blue-800' : 'text-green-800';

    if (isLoadingTeam) {
      return <p className="text-sm text-gray-500">Loading {teamName}...</p>;
    }
    const playerArray = Object.values(players);
    if (playerArray.length === 0) {
      return <div className={`${bgColor} rounded-lg p-3`}><p className="text-center text-gray-500 text-sm py-2">No players assigned.</p></div>;
    }
    const avgs = getTeamAverages(playerArray);
    return (
      <div className={`${bgColor} rounded-lg p-2 w-full`}>
        <div className="w-full">
          <table className="w-full border-collapse text-xs min-w-0">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 text-xs font-medium text-gray-600 uppercase">
                <th className="px-0.5 py-1 text-left">PLAYER</th>
                <th className="px-0.5 py-1 text-center">L10<br/>HLT</th>
                <th className="px-0.5 py-1 text-center">L10<br/>ADR</th>
                <th className="px-0.5 py-1 text-center">L10<br/>K/D</th>
                <th className="px-0.5 py-1 text-center">S<br/>HLT</th>
                <th className="px-0.5 py-1 text-center">S<br/>ADR</th>
                <th className="px-0.5 py-1 text-center">S<br/>K/D</th>
                <th className="px-0.5 py-1 text-center">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {playerArray.map((p, idx) => (
                <tr key={p.steamId} className={`border-b border-gray-200 bg-${teamColor}-50`}>
                  <td className="px-0.5 py-1 font-medium text-gray-900 truncate">{p.name}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(p.stats?.L10_HLTV2, 2)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(p.stats?.L10_ADR, 0)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(p.stats?.L10_KD, 2)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(p.stats?.S_HLTV2, 2)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(p.stats?.S_ADR, 0)}</td>
                  <td className="px-0.5 py-1 text-center">{formatStat(p.stats?.S_KD, 2)}</td>
                  <td className="px-0.5 py-1 text-center">
                    <button
                      className="text-xs text-red-500 hover:text-red-700 px-1 py-0.5 rounded"
                      onClick={() => handleRemovePlayerFromTeam(p.steamId, team)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={`${avgBgColor} font-bold ${avgTextColor} text-xs`}>
                <td className="px-0.5 py-1">TEAM AVG</td>
                <td className="px-0.5 py-1 text-center">{formatStat(avgs.L10_HLTV2, 2)}</td>
                <td className="px-0.5 py-1 text-center">{formatStat(avgs.L10_ADR, 0)}</td>
                <td className="px-0.5 py-1 text-center">{formatStat(avgs.L10_KD, 2)}</td>
                <td className="px-0.5 py-1 text-center">{formatStat(avgs.S_HLTV2, 2)}</td>
                <td className="px-0.5 py-1 text-center">{formatStat(avgs.S_ADR, 0)}</td>
                <td className="px-0.5 py-1 text-center">{formatStat(avgs.S_KD, 2)}</td>
                <td className="px-0.5 py-1"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full min-w-0 p-2">
      <h1 className="text-2xl font-semibold text-blue-600 mb-3">Takım Seçme</h1>
      <div className="flex flex-col lg:flex-row gap-3 w-full min-w-0">
        {/* Available Players Section */}
        <div className="lg:w-2/5 bg-white p-3 rounded-lg shadow border min-w-0">
          <h2 className="text-lg font-semibold mb-2 text-gray-700">Available Players ({availablePlayers.length})</h2>
          {renderAvailablePlayersList()}
        </div>

        {/* Team Selection Section */}
        <div className="lg:w-3/5 bg-white p-3 rounded-lg shadow border min-w-0">
          <h2 className="text-lg font-semibold mb-2 text-gray-700">Team Details</h2>
          <div className="flex flex-col xl:flex-row gap-3 mb-3">
            <div className="xl:w-1/2 min-w-0">
              <h3 className="text-base font-semibold text-blue-700 mb-2">Team A ({Object.keys(teamAPlayers).length})</h3>
              {renderTeamList('A', teamAPlayers, loadingTeamA)}
            </div>
            <div className="xl:w-1/2 min-w-0">
              <h3 className="text-base font-semibold text-green-700 mb-2">Team B ({Object.keys(teamBPlayers).length})</h3>
              {renderTeamList('B', teamBPlayers, loadingTeamB)}
            </div>
          </div>
          <p className="text-sm text-gray-500">Stats, Kabile selection, Map selection, and Create Match button will be here.</p>
        </div>
      </div>
    </div>
  );
}
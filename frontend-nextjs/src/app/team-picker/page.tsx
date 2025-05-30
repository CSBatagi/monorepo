'use client';

import React, { useEffect, useState, useCallback } from 'react';
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

export default function TeamPickerPage() {
  const { user, loading: authLoading } = useAuth();
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [firebaseAttendance, setFirebaseAttendance] = useState<FirebaseAttendanceData>({});
  const [teamAPlayers, setTeamAPlayers] = useState<TeamPlayerData>({});
  const [teamBPlayers, setTeamBPlayers] = useState<TeamPlayerData>({});

  const [loadingPlayersJson, setLoadingPlayersJson] = useState(true);
  const [loadingFirebaseData, setLoadingFirebaseData] = useState(true);
  const [loadingTeamA, setLoadingTeamA] = useState(true);
  const [loadingTeamB, setLoadingTeamB] = useState(true);

  console.log('[TeamPickerPage] Component Render - AuthLoading:', authLoading, 'User:', !!user);

  useEffect(() => {
    const fetchPlayersJson = async () => {
      console.log('[TeamPickerPage] Fetching players.json');
      try {
        setLoadingPlayersJson(true);
        const response = await fetch('/data/players.json?_cb=' + Date.now());
        if (!response.ok) throw new Error(`Failed to fetch players.json: ${response.statusText}`);
        const data: Player[] = await response.json();
        setAllPlayers(data);
        console.log('[TeamPickerPage] players.json loaded:', data.length, 'players');
      } catch (error) {
        console.error("[TeamPickerPage] Error fetching players.json:", error);
      } finally {
        setLoadingPlayersJson(false);
      }
    };
    fetchPlayersJson();
  }, []);

  useEffect(() => {
    if (!user) {
      setLoadingFirebaseData(false);
      setLoadingTeamA(false); // Ensure loading states are cleared if no user
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

  const getPlayerWithStats = useCallback((steamId: string): Player | undefined => {
    return allPlayers.find(p => p.steamId === steamId);
  }, [allPlayers]);

  const handleAssignPlayer = useCallback(async (playerSteamId: string, targetTeam: 'A' | 'B') => {
    console.log(`[TeamPickerPage] Assigning player ${playerSteamId} to Team ${targetTeam}`);
    const playerToAssign = getPlayerWithStats(playerSteamId);

    if (!playerToAssign) {
      console.error(`[TeamPickerPage] Player ${playerSteamId} not found in allPlayers. Cannot assign.`);
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
  }, [getPlayerWithStats, teamAPlayers, teamBPlayers]);

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

  const getAvailablePlayers = useCallback(() => {
    console.log('[TeamPickerPage] getAvailablePlayers called. Loading states: FirebaseData:', loadingFirebaseData, 'TeamA:', loadingTeamA, 'TeamB:', loadingTeamB);
    console.log('[TeamPickerPage] Data for getAvailablePlayers: firebaseAttendance:', firebaseAttendance, 'teamAPlayers:', teamAPlayers, 'teamBPlayers:', teamBPlayers);

    if (loadingFirebaseData || loadingTeamA || loadingTeamB || loadingPlayersJson) {
        console.log('[TeamPickerPage] getAvailablePlayers returning empty array due to loading state (or players.json still loading).');
        return [];
    }

    const players = Object.entries(firebaseAttendance)
      .filter(([steamId, data]) => 
        data.status === 'coming' && 
        !teamAPlayers[steamId] && 
        !teamBPlayers[steamId]
      )
      .map(([steamId, data]) => {
        const fullPlayer = getPlayerWithStats(steamId);
        return fullPlayer ? { ...fullPlayer, status: data.status } : {
          steamId: steamId,
          name: data.name || 'Unknown Player',
          status: data.status,
          // Add default/empty stats if fullPlayer not found to avoid render errors, though this shouldn't happen if players.json is loaded
          l10Hlt: null, l10Adr: null, l10Kd: null, sHlt: null, sAdr: null, sKd: null
        } as Player;
      });
    console.log('[TeamPickerPage] getAvailablePlayers calculated:', players);
    return players;
  }, [firebaseAttendance, teamAPlayers, teamBPlayers, loadingFirebaseData, loadingTeamA, loadingTeamB, loadingPlayersJson, getPlayerWithStats]);

  const availablePlayers = getAvailablePlayers();

  console.log('[TeamPickerPage] Final availablePlayers for render:', availablePlayers);
  console.log('[TeamPickerPage] Final loading states for render - Auth:', authLoading, 'FirebaseData:', loadingFirebaseData, 'TeamA:', loadingTeamA, 'TeamB:', loadingTeamB, 'PlayersJson:', loadingPlayersJson);


  const isLoading = authLoading || loadingFirebaseData || loadingTeamA || loadingTeamB || loadingPlayersJson;
  // For the initial display of available players, we primarily care about firebaseAttendance and team lists being loaded.
  // players.json can be loading in the background as it's for stats that aren't shown in the initial list.
  const isAvailablePlayersListLoading = loadingFirebaseData || loadingTeamA || loadingTeamB || loadingPlayersJson;


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
  
  const renderAvailablePlayersList = () => {
    if (isAvailablePlayersListLoading || loadingPlayersJson) {
      return <p className="text-sm text-gray-500">Loading available players and stats...</p>;
    }
    if (availablePlayers.length === 0) {
      if (loadingPlayersJson) {
        return <p className="text-sm text-gray-500">Checking player data...</p>;
      }
      return <p className="text-sm text-gray-500">No players are currently available or all coming players are assigned.</p>;
    }
    return (
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {availablePlayers.map(player => (
          <div key={player.steamId} className="flex items-center justify-between p-3 bg-gray-50 rounded-md shadow-sm border">
            <span className="font-medium text-sm text-gray-800">{player.name}</span>
            <div className="flex space-x-2">
              <button 
                className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded-md transition-colors"
                title={`Assign ${player.name} to Team A`}
                onClick={() => handleAssignPlayer(player.steamId, 'A')} 
              >
                Team A
              </button>
              <button 
                className="text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded-md transition-colors"
                title={`Assign ${player.name} to Team B`}
                onClick={() => handleAssignPlayer(player.steamId, 'B')} 
              >
                Team B
              </button>
              <button 
                className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-md transition-colors"
                title={`Mark ${player.name} as not coming`}
                onClick={() => handleMarkNotComing(player.steamId)} 
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderTeamList = (team: 'A' | 'B', players: TeamPlayerData, isLoadingTeam: boolean) => {
    const teamName = team === 'A' ? 'Team A' : 'Team B';
    const teamColor = team === 'A' ? 'blue' : 'green';

    if (isLoadingTeam || loadingPlayersJson) {
      return <p className="text-sm text-gray-500">Loading {teamName}...</p>;
    }
    const playerArray = Object.values(players);
    if (playerArray.length === 0) {
      return <p className="text-sm text-gray-500">No players in {teamName}.</p>;
    }
    return (
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {playerArray.map(p => {
          return (
            <div key={p.steamId} className={`text-sm p-2 bg-${teamColor}-50 rounded border border-${teamColor}-200 flex justify-between items-center`}>
              <span>{p.name}</span>
              <button 
                className="text-xs bg-red-500 hover:bg-red-600 text-white px-1 py-0.5 rounded-md transition-colors"
                title={`Remove ${p.name} from ${teamName}`}
                onClick={() => handleRemovePlayerFromTeam(p.steamId, team)}
              >
                X
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full max-w-none p-3 sm:p-4 md:p-6">
      <h1 className="text-2xl font-semibold text-blue-600 mb-4">Takım Seçme</h1>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Available Players Section */}
        <div className="lg:col-span-2 page-content-container bg-white p-4 rounded-lg shadow border">
          <h2 className="text-xl font-semibold mb-3 text-gray-700">Available Players ({availablePlayers.length})</h2>
          {renderAvailablePlayersList()}
          {!loadingPlayersJson && allPlayers.length === 0 && (
            <p className="text-xs text-red-500 mt-2">Warning: Player list (players.json) could not be loaded or is empty. Stats will be unavailable.</p>
          )}
        </div>

        {/* Team Selection Section */}
        <div className="lg:col-span-3 page-content-container bg-white p-4 rounded-lg shadow border">
          <h2 className="text-xl font-semibold mb-3 text-gray-700">Team Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-blue-700 mb-2">Team A ({Object.keys(teamAPlayers).length})</h3>
              {renderTeamList('A', teamAPlayers, loadingTeamA)}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-green-700 mb-2">Team B ({Object.keys(teamBPlayers).length})</h3>
              {renderTeamList('B', teamBPlayers, loadingTeamB)}
            </div>
          </div>
          <p className="text-sm text-gray-500">Stats, Kabile selection, Map selection, and Create Match button will be here.</p>
        </div>
      </div>
    </div>
  );
} 
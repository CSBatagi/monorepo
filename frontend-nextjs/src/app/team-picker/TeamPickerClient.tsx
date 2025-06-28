'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Player } from '@/types';
import { db } from '@/lib/firebase';
import { ref, onValue, off, set, update } from 'firebase/database';
import KabileSelect from '@/components/KabileSelect';
import TeamAveragesTable from '@/components/TeamAveragesTable';
import TeamComparisonRadar from '@/components/TeamComparisonRadar';

const ATTENDANCE_DB_PATH = 'attendanceState';
const TEAM_PICKER_DB_PATH = 'teamPickerState';

interface FirebaseAttendanceData {
  [steamId: string]: { name?: string; status: string; };
}

interface TeamPlayerData {
    [steamId: string]: Player; // Keyed by steamId, value is Player object
}

const STAT_LABELS: Record<string, string> = {
  L10_HLTV2: 'L10 HLTV',
  L10_ADR: 'L10 ADR',
  L10_KD: 'L10 K/D',
  S_HLTV2: 'S HLTV',
  S_ADR: 'S ADR',
  S_KD: 'S K/D',
};
const STAT_ORDER = [
  'L10_HLTV2',
  'L10_ADR',
  'L10_KD',
  'S_HLTV2',
  'S_ADR',
  'S_KD',
];
const FIXED_RANGES: Record<string, { min: number; max: number }> = {
  L10_HLTV2: { min: 0.70, max: 1.40 },
  L10_ADR: { min: 50, max: 100 },
  L10_KD: { min: 0.70, max: 1.40 },
  S_HLTV2: { min: 0.70, max: 1.40 },
  S_ADR: { min: 50, max: 100 },
  S_KD: { min: 0.70, max: 1.40 },
};

interface TeamPickerClientProps {
  kabileList: string[];
}

function formatStat(value: number | null | undefined, decimals: number = 2) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return decimals === 0 ? Math.round(value) : value.toFixed(decimals);
}

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

interface MapSelectionProps {
  teamAName: string;
  teamBName: string;
}
const MapSelection: React.FC<MapSelectionProps> = ({ teamAName, teamBName }) => {
  const [mapsList, setMapsList] = useState<{ id: string; name: string }[]>([]);
  const [mapsState, setMapsState] = useState<any>({});
  const [loadingMaps, setLoadingMaps] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch maps.json
  useEffect(() => {
    const fetchMaps = async () => {
      try {
        const res = await fetch('/data/maps.json?_cb=' + Date.now());
        const data = await res.json();
        setMapsList(data);
      } catch {
        setMapsList([]);
      }
    };
    fetchMaps();
  }, []);

  // Listen to Firebase for maps selection
  useEffect(() => {
    const mapsRef = ref(db, `${TEAM_PICKER_DB_PATH}/maps`);
    setLoadingMaps(true);
    const unsub = onValue(mapsRef, (snap) => {
      setMapsState(snap.val() || {});
      setLoadingMaps(false);
    }, () => setLoadingMaps(false));
    return () => off(mapsRef, 'value', unsub);
  }, []);

  // Helper to get map state for a given index
  const getMap = (i: number) => mapsState[`map${i}`] || { mapName: '', t_team: '', ct_team: '' };

  // Write to Firebase with side consistency logic
  const handleMapChange = async (i: number, mapName: string) => {
    setSaving(true);
    const mapNamePath = `${TEAM_PICKER_DB_PATH}/maps/map${i}/mapName`;
    await update(ref(db), { [mapNamePath]: mapName });
    setSaving(false);
  };
  const handleSideChange = async (i: number, side: 't' | 'ct', value: string) => {
    setSaving(true);
    const updates: any = {};
    const basePath = `${TEAM_PICKER_DB_PATH}/maps/map${i}`;
    updates[`${basePath}/${side}_team`] = value;
    // Side consistency: if T is A, CT must be B, etc.
    const otherSide = side === 't' ? 'ct' : 't';
    if (value) {
      const otherTeamShouldBe = value === 'A' ? 'B' : 'A';
      const otherTeamCurrent = getMap(i)[`${otherSide}_team`];
      if (!otherTeamCurrent || otherTeamCurrent === value) {
        updates[`${basePath}/${otherSide}_team`] = otherTeamShouldBe;
      }
    } else {
      updates[`${basePath}/${otherSide}_team`] = '';
    }
    await update(ref(db), updates);
    setSaving(false);
  };

  // Render
  return (
    <div className="mb-6">
      <h4 className="text-base font-semibold text-gray-700 mb-2">Harita ve Taraf Seçimi</h4>
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => {
          const map = getMap(i);
          return (
            <div
              key={i}
              className="flex flex-col md:flex-row md:items-center gap-2 bg-gray-50 rounded p-2 border border-gray-200"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600 w-8 md:w-10">{i}.</span>
                <select
                  className="border rounded px-2 py-1 text-sm w-full md:w-40"
                  value={map.mapName}
                  onChange={e => handleMapChange(i, e.target.value)}
                  disabled={loadingMaps || saving}
                >
                  <option value="">Harita Seç</option>
                  {mapsList.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">T:</span>
                <select
                  className="border rounded px-2 py-1 text-sm w-28"
                  value={map.t_team || ''}
                  onChange={e => handleSideChange(i, 't', e.target.value)}
                  disabled={loadingMaps || saving}
                >
                  <option value="">-</option>
                  <option value="A">{teamAName || 'A'}</option>
                  <option value="B">{teamBName || 'B'}</option>
                </select>
                <span className="text-xs text-gray-500">CT:</span>
                <select
                  className="border rounded px-2 py-1 text-sm w-28"
                  value={map.ct_team || ''}
                  onChange={e => handleSideChange(i, 'ct', e.target.value)}
                  disabled={loadingMaps || saving}
                >
                  <option value="">-</option>
                  <option value="A">{teamAName || 'A'}</option>
                  <option value="B">{teamBName || 'B'}</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SERVERACPASS = process.env.NEXT_PUBLIC_SERVERACPASS;

const TeamPickerClient: React.FC<TeamPickerClientProps> = ({ kabileList }) => {
  const { user, loading: authLoading } = useAuth();
  const [teamAPlayers, setTeamAPlayers] = useState<TeamPlayerData>({});
  const [teamBPlayers, setTeamBPlayers] = useState<TeamPlayerData>({});

  const [loadingFirebaseData, setLoadingFirebaseData] = useState(true);
  const [loadingTeamA, setLoadingTeamA] = useState(true);
  const [loadingTeamB, setLoadingTeamB] = useState(true);

  const [last10Stats, setLast10Stats] = useState<any[]>([]);
  const [seasonStats, setSeasonStats] = useState<any[]>([]);
  const [firebaseAttendance, setFirebaseAttendance] = useState<FirebaseAttendanceData>({});

  const [teamAKabile, setTeamAKabile] = useState('');
  const [teamBKabile, setTeamBKabile] = useState('');
  const [loadingKabile, setLoadingKabile] = useState(false);

  // --- Maps state for match creation ---
  const [mapsState, setMapsState] = useState<any>({});
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);

  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [serverPassword, setServerPassword] = useState('');
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);

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
      return;
    }
    setLoadingFirebaseData(true);
    const attendanceRef = ref(db, ATTENDANCE_DB_PATH);
    const onAttendanceValue = onValue(attendanceRef, (snapshot) => {
      const data = snapshot.val() || {};
      setFirebaseAttendance(data);
      setLoadingFirebaseData(false);
    }, () => setLoadingFirebaseData(false));

    setLoadingTeamA(true);
    const teamARef = ref(db, `${TEAM_PICKER_DB_PATH}/teamA/players`);
    const onTeamAValue = onValue(teamARef, (snapshot) => {
      const data = snapshot.val() || {};
      setTeamAPlayers(data);
      setLoadingTeamA(false);
    }, () => setLoadingTeamA(false));

    setLoadingTeamB(true);
    const teamBRef = ref(db, `${TEAM_PICKER_DB_PATH}/teamB/players`);
    const onTeamBValue = onValue(teamBRef, (snapshot) => {
      const data = snapshot.val() || {};
      setTeamBPlayers(data);
      setLoadingTeamB(false);
    }, () => setLoadingTeamB(false));

    return () => {
      off(attendanceRef, 'value', onAttendanceValue);
      off(teamARef, 'value', onTeamAValue);
      off(teamBRef, 'value', onTeamBValue);
    };
  }, [user]);

  // Listen for kabile changes from Firebase
  useEffect(() => {
    if (!user) return;
    const teamARef = ref(db, `${TEAM_PICKER_DB_PATH}/teamA/kabile`);
    const teamBRef = ref(db, `${TEAM_PICKER_DB_PATH}/teamB/kabile`);
    const onA = onValue(teamARef, (snap) => setTeamAKabile(snap.val() || ''));
    const onB = onValue(teamBRef, (snap) => setTeamBKabile(snap.val() || ''));
    return () => {
      off(teamARef, 'value', onA);
      off(teamBRef, 'value', onB);
    };
  }, [user]);

  // Listen to Firebase for maps selection (for match creation)
  useEffect(() => {
    const mapsRef = ref(db, `${TEAM_PICKER_DB_PATH}/maps`);
    const unsub = onValue(mapsRef, (snap) => {
      setMapsState(snap.val() || {});
    });
    return () => off(mapsRef, 'value', unsub);
  }, []);

  // Handlers for kabile change
  const handleKabileChange = async (team: 'A' | 'B', kabile: string) => {
    // Optimistically update local state
    if (team === 'A') setTeamAKabile(kabile);
    else setTeamBKabile(kabile);
    const teamPath = team === 'A' ? 'teamA' : 'teamB';
    const kabileRef = ref(db, `${TEAM_PICKER_DB_PATH}/${teamPath}/kabile`);
    await set(kabileRef, kabile);
  };

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
      .filter(([_, data]) => data.status === 'coming')
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
        return valueB - valueA;
      });
  }, [firebaseAttendance, teamAPlayers, teamBPlayers, loadingFirebaseData, loadingTeamA, loadingTeamB, getStatsBySteamId]);

  const handleAssignPlayer = useCallback(async (playerSteamId: string, targetTeam: 'A' | 'B') => {
    const playerToAssign = availablePlayers.find(p => p.steamId === playerSteamId);
    if (!playerToAssign) return;
    const otherTeam = targetTeam === 'A' ? 'B' : 'A';
    const otherTeamPlayers = targetTeam === 'A' ? teamBPlayers : teamAPlayers;
    if (otherTeamPlayers[playerSteamId]) {
      const otherTeamRef = ref(db, `${TEAM_PICKER_DB_PATH}/team${otherTeam}/players/${playerSteamId}`);
      try { await set(otherTeamRef, null); } catch {}
    }
    const teamRef = ref(db, `${TEAM_PICKER_DB_PATH}/team${targetTeam}/players/${playerSteamId}`);
    try { await set(teamRef, playerToAssign); } catch {}
  }, [availablePlayers, teamAPlayers, teamBPlayers]);

  const handleRemovePlayerFromTeam = useCallback(async (playerSteamId: string, targetTeam: 'A' | 'B') => {
    const teamRef = ref(db, `${TEAM_PICKER_DB_PATH}/team${targetTeam}/players/${playerSteamId}`);
    try { await set(teamRef, null); } catch {}
  }, []);

  const handleMarkNotComing = useCallback(async (playerSteamId: string) => {
    const playerInTeamA = teamAPlayers[playerSteamId];
    const playerInTeamB = teamBPlayers[playerSteamId];
    if (playerInTeamA) await handleRemovePlayerFromTeam(playerSteamId, 'A');
    if (playerInTeamB) await handleRemovePlayerFromTeam(playerSteamId, 'B');
    const attendanceStatusRef = ref(db, `${ATTENDANCE_DB_PATH}/${playerSteamId}/status`);
    try { await set(attendanceStatusRef, 'not_coming'); } catch {}
  }, [teamAPlayers, teamBPlayers, handleRemovePlayerFromTeam]);

  // --- Match creation handler ---
  const handleCreateMatch = async () => {
    setCreatingMatch(true);
    setMatchMessage(null);
    try {
      // 1. Gather teams
      const getTeamObj = (team: 'A' | 'B', players: TeamPlayerData, kabile: string) => {
        const playerEntries = Object.entries(players).filter(([_, p]) => p && p.steamId && p.name);
        if (playerEntries.length === 0) return null;
        const playersObj: Record<string, string> = {};
        playerEntries.forEach(([_, p]) => { playersObj[p.steamId] = p.name; });
        return { name: kabile || (team === 'A' ? 'Team A' : 'Team B'), players: playersObj };
      };
      const team1 = getTeamObj('A', teamAPlayers, teamAKabile);
      const team2 = getTeamObj('B', teamBPlayers, teamBKabile);
      if (!team1 || !team2) {
        setMatchMessage('Her iki takımda da en az bir oyuncu olmalı.');
        setCreatingMatch(false);
        return;
      }
      // 2. Gather maps and sides
      const maps = [mapsState.map1?.mapName, mapsState.map2?.mapName, mapsState.map3?.mapName].filter((m) => m && m !== '');
      if (maps.length === 0) {
        setMatchMessage('En az bir harita seçmelisiniz.');
        setCreatingMatch(false);
        return;
      }
      const mapSides: string[] = [];
      for (let i = 1; i <= maps.length; i++) {
        const mapSel = mapsState[`map${i}`];
        let side = 'knife';
        if (mapSel?.ct_team === 'A') side = 'team1_ct';
        else if (mapSel?.ct_team === 'B') side = 'team2_ct';
        mapSides.push(side);
      }
      while (mapSides.length < maps.length) mapSides.push('knife');
      mapSides.length = maps.length;
      // 3. Build payload
      const payload = {
        team1,
        team2,
        num_maps: maps.length,
        maplist: maps,
        map_sides: mapSides,
        clinch_series: true,
        players_per_team: Object.keys(team1.players).length,
        cvars: {
          tv_enable: 1,
          hostname: `${team1.name} vs ${team2.name}`,
        },
      };
      // 4. POST to worker
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''; // Get basePath from env
      const resp = await fetch(`${basePath}/api/create-match`, { // Prepend basePath
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.text();
        setMatchMessage(`Hata: ${resp.status} - ${err}`);
        setCreatingMatch(false);
        return;
      }
      setMatchMessage('Maç başarıyla oluşturuldu!');
    } catch (e: any) {
      setMatchMessage('Bir hata oluştu: ' + (e?.message || e));
    } finally {
      setCreatingMatch(false);
    }
  };

  // --- Server Aç handler ---
  const handleStartServer = async () => {
    setServerMessage(null);
    setCreatingServer(true);
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''; // Get basePath from env
      const resp = await fetch(`${basePath}/api/start-vm`, { // Prepend basePath
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: serverPassword }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        setServerMessage(`Hata: ${resp.status} - ${err}`);
        setCreatingServer(false);
        return;
      }
      setServerMessage('Server başarıyla başlatıldı!');
    } catch (e: any) {
      setServerMessage('Bir hata oluştu: ' + (e?.message || e));
    } finally {
      setCreatingServer(false);
    }
  };

  const isLoading = authLoading || loadingFirebaseData || loadingTeamA || loadingTeamB;
  const isAvailablePlayersListLoading = loadingFirebaseData || loadingTeamA || loadingTeamB;

  if (authLoading) {
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
    const teamName = team === 'A' ? (teamAKabile || 'Team A') : (teamBKabile || 'Team B');
    const teamColor = team === 'A' ? 'blue' : 'green';
    const bgColor = team === 'A' ? 'bg-blue-100' : 'bg-green-100';
    const avgBgColor = team === 'A' ? 'bg-blue-200' : 'bg-green-200';
    const avgTextColor = team === 'A' ? 'text-blue-800' : 'text-green-800';
    const kabileValue = team === 'A' ? teamAKabile : teamBKabile;
    const setKabile = (kabile: string) => handleKabileChange(team, kabile);

    if (isLoadingTeam) {
      return <p className="text-sm text-gray-500">Loading {teamName}...</p>;
    }
    const playerArray = Object.values(players)
      .slice() // copy to avoid mutating state
      .sort((a, b) => {
        const aHLTV2 = a.stats?.L10_HLTV2 ?? -Infinity;
        const bHLTV2 = b.stats?.L10_HLTV2 ?? -Infinity;
        return bHLTV2 - aHLTV2;
      });
    if (playerArray.length === 0) {
      return <div className={`${bgColor} rounded-lg p-3`}>
        <KabileSelect value={kabileValue} onChange={setKabile} kabileList={kabileList} loading={loadingKabile} label="Kabile" />
        <p className="text-center text-gray-500 text-sm py-2">No players assigned.</p>
      </div>;
    }
    const avgs = getTeamAverages(playerArray);
    return (
      <div className={`${bgColor} rounded-lg p-2 w-full`}>
        <KabileSelect value={kabileValue} onChange={setKabile} kabileList={kabileList} loading={loadingKabile} label="Kabile" />
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

  // Calculate team averages for comparison
  const teamAAvgs = getTeamAverages(Object.values(teamAPlayers));
  const teamBAvgs = getTeamAverages(Object.values(teamBPlayers));

  return (
    <div className="w-full min-w-0 p-2">
      <h1 className="text-2xl font-semibold text-blue-600 mb-3">Takım Seçme</h1>
      <div className="flex flex-col lg:flex-row gap-3 w-full min-w-0">
        {/* Available Players Section */}
        <div className="lg:w-2/5 bg-white p-3 rounded-lg shadow border min-w-0">
          <h2 className="text-lg font-semibold mb-2 text-gray-700">Gelen Oyuncular ({availablePlayers.length})</h2>
          {renderAvailablePlayersList()}
        </div>

        {/* Team Selection Section */}
        <div className="lg:w-3/5 bg-white p-3 rounded-lg shadow border min-w-0">
          <h2 className="text-lg font-semibold mb-2 text-gray-700">Takım Seçimi</h2>
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
          {/* Team averages comparison table and radar chart */}
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Takım Ortalamaları Karşılaştırması</h4>
            <TeamAveragesTable teamA={teamAAvgs} teamB={teamBAvgs} statLabels={STAT_LABELS} statOrder={STAT_ORDER} />
            <div className="mt-4">
              <TeamComparisonRadar teamA={teamAAvgs} teamB={teamBAvgs} statLabels={STAT_LABELS} statOrder={STAT_ORDER} fixedRanges={FIXED_RANGES} />
            </div>
          </div>
          {/* Map selection after the graph comparison */}
          <MapSelection teamAName={teamAKabile || 'A'} teamBName={teamBKabile || 'B'} />
          <div className="flex flex-col items-center mt-4 gap-2">
            <div className="flex flex-row gap-2">
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCreateMatch}
                disabled={creatingMatch}
              >
                {creatingMatch ? 'Oluşturuluyor...' : 'Maç Yarat'}
              </button>
              <button
                className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setServerModalOpen(true)}
                disabled={creatingServer}
              >
                {creatingServer ? 'Açılıyor...' : 'Server Aç'}
              </button>
            </div>
            {matchMessage && (
              <div className={`mt-2 text-sm ${matchMessage.startsWith('Maç') ? 'text-green-600' : 'text-red-600'}`}>{matchMessage}</div>
            )}
            {serverMessage && (
              <div className={`mt-2 text-sm ${serverMessage.startsWith('Server') ? 'text-green-600' : 'text-red-600'}`}>{serverMessage}</div>
            )}
          </div>
        </div>
      </div>
      {/* Server Aç Modal */}
      {serverModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-xs">
            <h2 className="text-lg font-bold mb-4 text-gray-800">Server Açmak için Şifre</h2>
            <input
              type="password"
              className="w-full border px-3 py-2 rounded mb-4 text-black"
              placeholder="Şifre"
              value={serverPassword}
              onChange={e => setServerPassword(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded"
                onClick={async () => {
                  setServerModalOpen(false);
                  setServerPassword('');
                  await handleStartServer();
                }}
              >Onayla</button>
              <button
                className="flex-1 bg-gray-400 hover:bg-gray-500 text-white py-2 rounded"
                onClick={() => { setServerModalOpen(false); setServerPassword(''); }}
              >İptal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamPickerClient;
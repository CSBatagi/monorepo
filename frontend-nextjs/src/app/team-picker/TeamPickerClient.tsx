'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { Player } from '@/types';
import { useLivePolling } from '@/lib/useLivePolling';
import {
  assignPlayer as apiAssignPlayer,
  removePlayer as apiRemovePlayer,
  updateTeamPicker,
  updatePlayerOverride,
  resetTeamPicker,
  updateAttendance,
} from '@/lib/liveApi';
import TeamAveragesTable from '@/components/TeamAveragesTable';
import TeamComparisonRadar from '@/components/TeamComparisonRadar';

interface FirebaseAttendanceData {
  [steamId: string]: { name?: string; status: string; };
}

interface TeamPlayerData {
    [steamId: string]: Player; // Keyed by steamId, value is Player object
}

type EditableStatKey = 'L10_HLTV2' | 'L10_ADR' | 'L10_KD' | 'S_HLTV2' | 'S_ADR' | 'S_KD';
type PlayerStats = Record<EditableStatKey, number | null>;

interface PlayerStatsOverrides {
  [steamId: string]: Partial<PlayerStats>;
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
const EDITABLE_STAT_KEYS = STAT_ORDER as EditableStatKey[];

type TeamNameMode = 'generic' | 'captain';

function formatStat(value: number | null | undefined, decimals: number = 2) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return decimals === 0 ? Math.round(value) : value.toFixed(decimals);
}

function formatPercent(value: number | null | undefined, decimals: number = 1) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return `${value.toFixed(decimals)}%`;
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
  mapsState: any;
  onMapsChange: (newMaps: any) => void;
}
const MapSelection: React.FC<MapSelectionProps> = ({ teamAName, teamBName, mapsState, onMapsChange }) => {
  const [mapsList, setMapsList] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Fetch maps.json (static data, not from Firebase)
  useEffect(() => {
    const fetchMaps = async () => {
      try {
        const res = await fetch('/data/maps.json');
        const data = await res.json();
        setMapsList(data);
      } catch {
        setMapsList([]);
      }
    };
    fetchMaps();
  }, []);

  const getMap = (i: number) => mapsState[`map${i}`] || { mapName: '', t_team: '', ct_team: '' };

  const handleMapChange = async (i: number, mapName: string) => {
    setSaving(true);
    const newMaps = { ...mapsState, [`map${i}`]: { ...getMap(i), mapName } };
    try { await updateTeamPicker({ maps: newMaps }); onMapsChange(newMaps); } catch {}
    setSaving(false);
  };

  const handleSideChange = async (i: number, side: 't' | 'ct', value: string) => {
    setSaving(true);
    const map = { ...getMap(i) };
    map[`${side}_team`] = value;
    const otherSide = side === 't' ? 'ct' : 't';
    if (value) {
      const otherTeamShouldBe = value === 'A' ? 'B' : 'A';
      if (!map[`${otherSide}_team`] || map[`${otherSide}_team`] === value) {
        map[`${otherSide}_team`] = otherTeamShouldBe;
      }
    } else {
      map[`${otherSide}_team`] = '';
    }
    const newMaps = { ...mapsState, [`map${i}`]: map };
    try { await updateTeamPicker({ maps: newMaps }); onMapsChange(newMaps); } catch {}
    setSaving(false);
  };
  const loadingMaps = false;

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

const TeamPickerClient: React.FC = () => {
  const { user, ready } = useSession();
  const authLoading = !ready;

  // --- Live polling replaces Firebase RTDB listeners (data from local PostgreSQL, sub-ms) ---
  const { data: attendanceData, loading: loadingAttendancePoll, refetch: refetchAttendance } = useLivePolling<{ attendance?: FirebaseAttendanceData }>({
    url: '/api/live/attendance',
    intervalMs: 3000,
    enabled: !!user,
    initialData: {},
  });
  const firebaseAttendancePoll = attendanceData.attendance || {};

  const { data: teamPickerData, loading: loadingTeamPickerPoll, refetch: refetchTeamPicker } = useLivePolling<{
    teamA?: { players: TeamPlayerData; nameMode: string; captainSteamId: string; kabile: string };
    teamB?: { players: TeamPlayerData; nameMode: string; captainSteamId: string; kabile: string };
    maps?: any;
    overrides?: PlayerStatsOverrides;
  }>({
    url: '/api/live/team-picker',
    intervalMs: 3000,
    enabled: !!user,
    initialData: {},
  });

  const loadingFirebaseData = loadingAttendancePoll;
  const loadingTeamA = loadingTeamPickerPoll;
  const loadingTeamB = loadingTeamPickerPoll;

  const [last10Stats, setLast10Stats] = useState<any[]>([]);
  const [seasonStats, setSeasonStats] = useState<any[]>([]);
  const [loadingStats, setLoadingStats] = useState<boolean>(true);
  const [mapStats, setMapStats] = useState<any[]>([]);
  const [loadingMapStats, setLoadingMapStats] = useState<boolean>(true);
  const [mapNameLookup, setMapNameLookup] = useState<Record<string, string>>({});
  // Derive state from polling data (replaces Firebase onValue listeners)
  const firebaseAttendance: FirebaseAttendanceData = firebaseAttendancePoll;
  const teamAPlayers: TeamPlayerData = teamPickerData.teamA?.players || {};
  const teamBPlayers: TeamPlayerData = teamPickerData.teamB?.players || {};
  const playerStatsOverrides: PlayerStatsOverrides = teamPickerData.overrides || {};
  const teamANameMode: TeamNameMode = (teamPickerData.teamA?.nameMode === 'captain' ? 'captain' : 'generic');
  const teamBNameMode: TeamNameMode = (teamPickerData.teamB?.nameMode === 'captain' ? 'captain' : 'generic');
  const teamACaptainSteamId: string = teamPickerData.teamA?.captainSteamId || '';
  const teamBCaptainSteamId: string = teamPickerData.teamB?.captainSteamId || '';

  const [editingPlayer, setEditingPlayer] = useState<{ steamId: string; name: string } | null>(null);
  const [editingStatsForm, setEditingStatsForm] = useState<Record<EditableStatKey, string>>({
    L10_HLTV2: '',
    L10_ADR: '',
    L10_KD: '',
    S_HLTV2: '',
    S_ADR: '',
    S_KD: '',
  });
  const [editStatsSaving, setEditStatsSaving] = useState(false);
  const [editStatsMessage, setEditStatsMessage] = useState<string | null>(null);

  // --- Maps state for match creation (comes from polling, see below) ---
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [pluginsMessage, setPluginsMessage] = useState<string | null>(null);

  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [serverPassword, setServerPassword] = useState('');
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);

  const [stopServerModalOpen, setStopServerModalOpen] = useState(false);
  const [stoppingServer, setStoppingServer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        // Use /api/stats/check (backed by backend memory) for stats data.
        // The endpoint returns { updated: false } when nothing changed — only
        // overwrite local state when the response actually contains data keys.
        const res = await fetch(`/api/stats/check?_cb=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (data.updated) {
          if ('last10' in data) setLast10Stats(Array.isArray(data.last10) ? data.last10 : []);
          if ('season_avg' in data) setSeasonStats(Array.isArray(data.season_avg) ? data.season_avg : []);
        }
        setLoadingStats(false);
      } catch {
        if (!cancelled) {
          setLoadingStats(false);
        }
      }
    };
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchMapNames = async () => {
      try {
        const res = await fetch('/data/maps.json');
        const data = await res.json();
        if (cancelled) return;
        const lookup: Record<string, string> = {};
        if (Array.isArray(data)) {
          data.forEach((entry) => {
            if (entry?.id) {
              lookup[String(entry.id)] = entry.name || entry.id;
            }
          });
        }
        setMapNameLookup(lookup);
      } catch {
        if (!cancelled) setMapNameLookup({});
      }
    };
    fetchMapNames();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchMapStats = async () => {
      setLoadingMapStats(true);
      try {
        // map_stats is read from disk (runtime-data/map_stats.json), kept fresh by
        // layout.tsx after() hook. Unlike last10/season_avg, map_stats is not available
        // via /api/stats/check when there are no new stats — so disk is the correct source here.
        const res = await fetch('/api/data/map_stats');
        let data: any = null;
        try { data = await res.json(); } catch { data = null; }
        if (cancelled) return;
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.map_stats) ? data.map_stats : [];
        setMapStats(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setMapStats([]);
      } finally {
        if (!cancelled) setLoadingMapStats(false);
      }
    };
    fetchMapStats();
    return () => { cancelled = true; };
  }, []);

  // Polling-based data is derived above via useLivePolling — no Firebase listeners needed

  const getDisplayNameBySteamId = useCallback((steamId: string, fallback: string) => {
    const inA = teamAPlayers?.[steamId]?.name;
    const inB = teamBPlayers?.[steamId]?.name;
    const inAttendance = firebaseAttendance?.[steamId]?.name;
    return (inA || inB || inAttendance || fallback).trim();
  }, [firebaseAttendance, teamAPlayers, teamBPlayers]);

  const teamAName = useMemo(() => {
    if (teamANameMode !== 'captain' || !teamACaptainSteamId) return 'Team A';
    const captainName = getDisplayNameBySteamId(teamACaptainSteamId, teamACaptainSteamId);
    return `Team ${captainName}`;
  }, [getDisplayNameBySteamId, teamACaptainSteamId, teamANameMode]);

  const teamBName = useMemo(() => {
    if (teamBNameMode !== 'captain' || !teamBCaptainSteamId) return 'Team B';
    const captainName = getDisplayNameBySteamId(teamBCaptainSteamId, teamBCaptainSteamId);
    return `Team ${captainName}`;
  }, [getDisplayNameBySteamId, teamBCaptainSteamId, teamBNameMode]);

  // Maps state comes from team-picker polling data
  const mapsState = teamPickerData.maps || {};

  const handleTeamNameModeChange = useCallback(async (team: 'A' | 'B', mode: TeamNameMode) => {
    const field = team === 'A' ? 'teamA_nameMode' : 'teamB_nameMode';
    try { await updateTeamPicker({ [field]: mode }); void refetchTeamPicker(); } catch {}
  }, [refetchTeamPicker]);

  const handleCaptainChange = useCallback(async (team: 'A' | 'B', captainSteamId: string) => {
    const field = team === 'A' ? 'teamA_captain' : 'teamB_captain';
    try { await updateTeamPicker({ [field]: captainSteamId }); void refetchTeamPicker(); } catch {}
  }, [refetchTeamPicker]);

  const getBaseStatsBySteamId = useCallback((steamId: string): PlayerStats => {
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

  const getStatsBySteamId = useCallback((steamId: string): PlayerStats => {
    const base = getBaseStatsBySteamId(steamId);
    const override = playerStatsOverrides[steamId] || {};
    return { ...base, ...override };
  }, [getBaseStatsBySteamId, playerStatsOverrides]);

  const openEditStatsModal = useCallback((steamId: string, name: string) => {
    const stats = getStatsBySteamId(steamId);
    const nextForm = {} as Record<EditableStatKey, string>;
    EDITABLE_STAT_KEYS.forEach((key) => {
      const value = stats[key];
      nextForm[key] = value === null || value === undefined || isNaN(value) ? '' : String(value);
    });
    setEditingPlayer({ steamId, name });
    setEditingStatsForm(nextForm);
    setEditStatsMessage(null);
  }, [getStatsBySteamId]);

  const closeEditStatsModal = useCallback(() => {
    setEditingPlayer(null);
    setEditStatsMessage(null);
    setEditStatsSaving(false);
  }, []);

  const handleEditStatInputChange = useCallback((key: EditableStatKey, value: string) => {
    setEditingStatsForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSaveEditedStats = useCallback(async () => {
    if (!editingPlayer) return;
    setEditStatsSaving(true);
    setEditStatsMessage(null);
    try {
      const updates: Partial<PlayerStats> = {};
      EDITABLE_STAT_KEYS.forEach((key) => {
        const raw = editingStatsForm[key]?.trim();
        if (raw === '') return;
        const parsed = Number(raw);
        if (!isNaN(parsed)) {
          updates[key] = parsed;
        }
      });
      await updatePlayerOverride(editingPlayer.steamId, Object.keys(updates).length > 0 ? updates as Record<string, number> : null);
      void refetchTeamPicker();
      setEditStatsMessage('Kaydedildi. Degisiklikler herkese yansidi.');
    } catch {
      setEditStatsMessage('Kaydetme sirasinda hata olustu.');
    } finally {
      setEditStatsSaving(false);
    }
  }, [editingPlayer, editingStatsForm]);

  const handleRevertEditedStats = useCallback(async () => {
    if (!editingPlayer) return;
    setEditStatsSaving(true);
    setEditStatsMessage(null);
    try {
      await updatePlayerOverride(editingPlayer.steamId, null);
      void refetchTeamPicker();
      const baseStats = getBaseStatsBySteamId(editingPlayer.steamId);
      const nextForm = {} as Record<EditableStatKey, string>;
      EDITABLE_STAT_KEYS.forEach((key) => {
        const value = baseStats[key];
        nextForm[key] = value === null || value === undefined || isNaN(value) ? '' : String(value);
      });
      setEditingStatsForm(nextForm);
      setEditStatsMessage('Varsayilan degerler geri yuklendi.');
    } catch {
      setEditStatsMessage('Geri alma sirasinda hata olustu.');
    } finally {
      setEditStatsSaving(false);
    }
  }, [editingPlayer, getBaseStatsBySteamId]);

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
    try { await apiAssignPlayer(playerSteamId, targetTeam, playerToAssign); void refetchTeamPicker(); } catch {}
  }, [availablePlayers, refetchTeamPicker]);

  const handleRemovePlayerFromTeam = useCallback(async (playerSteamId: string, targetTeam: 'A' | 'B') => {
    try { await apiRemovePlayer(playerSteamId, targetTeam); void refetchTeamPicker(); } catch {}
  }, [refetchTeamPicker]);

  const handleMarkNotComing = useCallback(async (playerSteamId: string) => {
    const playerInTeamA = teamAPlayers[playerSteamId];
    const playerInTeamB = teamBPlayers[playerSteamId];
    if (playerInTeamA) await handleRemovePlayerFromTeam(playerSteamId, 'A');
    if (playerInTeamB) await handleRemovePlayerFromTeam(playerSteamId, 'B');
    const name = firebaseAttendance[playerSteamId]?.name || playerSteamId;
    try { await updateAttendance(playerSteamId, name, { status: 'not_coming' }); void refetchAttendance(); } catch {}
  }, [teamAPlayers, teamBPlayers, firebaseAttendance, handleRemovePlayerFromTeam, refetchAttendance]);

  // --- Match creation handler ---
  const handleCreateMatch = async () => {
    setCreatingMatch(true);
    setMatchMessage(null);
    try {
      // 1. Gather teams
      const getTeamObj = (team: 'A' | 'B', players: TeamPlayerData, name: string) => {
        const playerEntries = Object.entries(players).filter(([_, p]) => p && p.steamId && p.name);
        if (playerEntries.length === 0) return null;
        const playersObj: Record<string, string> = {};
        playerEntries.forEach(([_, p]) => { playersObj[p.steamId] = p.name; });
        return { name: name || (team === 'A' ? 'Team A' : 'Team B'), players: playersObj };
      };
      const team1 = getTeamObj('A', teamAPlayers, teamAName);
      const team2 = getTeamObj('B', teamBPlayers, teamBName);
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

  // --- Hidden Load Plugins handler ---
  const handleLoadPlugins = async () => {
    setPluginsMessage(null);
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const resp = await fetch(`${basePath}/api/load-plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: true }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        setPluginsMessage(`Hata: ${resp.status} - ${err}`);
        return;
      }
      setPluginsMessage('Plugin komutu gönderildi.');
    } catch (e: any) {
      setPluginsMessage('Bir hata oluştu: ' + (e?.message || e));
    }
  };

  // --- Stop Server handler ---
  const handleStopServer = async () => {
    setServerMessage(null);
    setStoppingServer(true);
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const resp = await fetch(`${basePath}/api/stop-vm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: serverPassword }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        setServerMessage(`Hata: ${resp.status} - ${err}`);
        setStoppingServer(false);
        return;
      }
      setServerMessage('Server başarıyla kapatıldı!');
    } catch (e: any) {
      setServerMessage('Bir hata oluştu: ' + (e?.message || e));
    } finally {
      setStoppingServer(false);
    }
  };

  const isLoading = authLoading || loadingFirebaseData || loadingTeamA || loadingTeamB;
  const isAvailablePlayersListLoading = loadingFirebaseData || loadingTeamA || loadingTeamB;

  if (authLoading) {
    return <div className="text-center py-10">Authenticating...</div>;
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
                          onClick={() => openEditStatsModal(player.steamId, player.name)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                    {isAssigned && (
                      <button
                        className="text-xs text-gray-500 hover:text-gray-700 ml-2"
                        type="button"
                        onClick={() => openEditStatsModal(player.steamId, player.name)}
                      >
                        Edit
                      </button>
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

  const renderMapStats = () => {
    if (loadingMapStats) {
      return <p className="text-sm text-gray-500">Harita istatistikleri yükleniyor...</p>;
    }
    if (!mapStats || mapStats.length === 0) {
      return <p className="text-sm text-gray-500">Bu sezon için harita verisi bulunamadı.</p>;
    }
    const sorted = [...mapStats].sort((a, b) => {
      const aMatches = Number(a?.matches_played) || 0;
      const bMatches = Number(b?.matches_played) || 0;
      return bMatches - aMatches || String(a?.map_name || '').localeCompare(String(b?.map_name || ''));
    });

    const formatBucket = (entry: any, bucket: string) => {
      const data = entry?.by_player_count?.[bucket];
      if (!data) return '-';
      const ct = formatPercent(Number(data.ct_win_pct) || 0, 0);
      const t = formatPercent(Number(data.t_win_pct) || 0, 0);
      const matches = formatStat(Number(data.matches_played) || 0, 0);
      return `${ct} / ${t} (${matches})`;
    };

    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[520px]">
          <thead>
            <tr className="bg-gray-100 text-xs font-medium text-gray-600 uppercase">
              <th className="px-2 py-1 text-left">Harita</th>
              <th className="px-2 py-1 text-center">Maç</th>
              <th className="px-2 py-1 text-center">CT/T</th>
              <th className="px-2 py-1 text-center">5v5</th>
              <th className="px-2 py-1 text-center">6v6</th>
              <th className="px-2 py-1 text-center">7v7+</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => {
              const mapName = String(entry?.map_name || '');
              const displayName = mapNameLookup[mapName] || mapName || '-';
              const ctPct = formatPercent(Number(entry?.ct_win_pct) || 0, 0);
              const tPct = formatPercent(Number(entry?.t_win_pct) || 0, 0);
              return (
                <tr key={mapName} className="border-b border-gray-200">
                  <td className="px-2 py-1 font-medium text-gray-900">{displayName}</td>
                  <td className="px-2 py-1 text-center">{formatStat(Number(entry?.matches_played) || 0, 0)}</td>
                  <td className="px-2 py-1 text-center">{`${ctPct} / ${tPct}`}</td>
                  <td className="px-2 py-1 text-center">{formatBucket(entry, '5')}</td>
                  <td className="px-2 py-1 text-center">{formatBucket(entry, '6')}</td>
                  <td className="px-2 py-1 text-center">{formatBucket(entry, '7')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 text-[11px] text-gray-500">
          CT/T oranları raund kazanç yüzdesine göredir. Parantez içi maç sayısıdır.
        </div>
      </div>
    );
  };

  // Table for team lists
  const renderTeamList = (team: 'A' | 'B', players: TeamPlayerData, isLoadingTeam: boolean) => {
    const teamName = team === 'A' ? teamAName : teamBName;
    const teamColor = team === 'A' ? 'blue' : 'green';
    const bgColor = team === 'A' ? 'bg-blue-100' : 'bg-green-100';
    const avgBgColor = team === 'A' ? 'bg-blue-200' : 'bg-green-200';
    const avgTextColor = team === 'A' ? 'text-blue-800' : 'text-green-800';
    const nameMode = team === 'A' ? teamANameMode : teamBNameMode;
    const captainSteamId = team === 'A' ? teamACaptainSteamId : teamBCaptainSteamId;
    const setMode = (mode: TeamNameMode) => handleTeamNameModeChange(team, mode);
    const setCaptain = (steamId: string) => handleCaptainChange(team, steamId);

    if (isLoadingTeam) {
      return <p className="text-sm text-gray-500">Loading {teamName}...</p>;
    }
    const playerArray = Object.values(players)
      .map((p) => ({
        ...p,
        stats: getStatsBySteamId(p.steamId),
      }))
      .slice() // copy to avoid mutating state
      .sort((a, b) => {
        const aHLTV2 = a.stats?.L10_HLTV2 ?? -Infinity;
        const bHLTV2 = b.stats?.L10_HLTV2 ?? -Infinity;
        return bHLTV2 - aHLTV2;
      });
    if (playerArray.length === 0) {
      return <div className={`${bgColor} rounded-lg p-3`}>
        <div className="mb-2">
          <div className="text-xs text-gray-600 mb-1">Takım adı</div>
          <select
            className="border rounded px-2 py-1 text-sm w-full"
            value={nameMode}
            onChange={(e) => setMode(e.target.value === 'captain' ? 'captain' : 'generic')}
          >
            <option value="generic">{team === 'A' ? 'Team A' : 'Team B'}</option>
            <option value="captain">Kaptan adıyla (Team &lt;Kaptan&gt;)</option>
          </select>
        </div>
        <div className="mb-2">
          <div className="text-xs text-gray-600 mb-1">Kaptan</div>
          <select className="border rounded px-2 py-1 text-sm w-full" value={captainSteamId} onChange={(e) => setCaptain(e.target.value)} disabled>
            <option value="">Önce oyuncu ekleyin</option>
          </select>
        </div>
        <p className="text-center text-gray-500 text-sm py-2">No players assigned.</p>
      </div>;
    }
    const avgs = getTeamAverages(playerArray);

    const teamMemberIds = new Set(playerArray.map((p) => p.steamId));
    const effectiveCaptain = teamMemberIds.has(captainSteamId) ? captainSteamId : '';

    return (
      <div className={`${bgColor} rounded-lg p-2 w-full`}>
        <div className="mb-2 flex flex-col md:flex-row gap-2">
          <div className="flex-1">
            <div className="text-xs text-gray-600 mb-1">Takım adı</div>
            <select
              className="border rounded px-2 py-1 text-sm w-full"
              value={nameMode}
              onChange={(e) => setMode(e.target.value === 'captain' ? 'captain' : 'generic')}
            >
              <option value="generic">{team === 'A' ? 'Team A' : 'Team B'}</option>
              <option value="captain">Kaptan adıyla (Team &lt;Kaptan&gt;)</option>
            </select>
          </div>
          <div className="flex-1">
            <div className="text-xs text-gray-600 mb-1">Kaptan</div>
            <select
              className="border rounded px-2 py-1 text-sm w-full"
              value={effectiveCaptain}
              onChange={(e) => setCaptain(e.target.value)}
              disabled={nameMode !== 'captain'}
            >
              <option value="">Kaptan seç</option>
              {playerArray.map((p) => (
                <option key={p.steamId} value={p.steamId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
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
      {loadingStats && (
        <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 flex items-center gap-2 animate-pulse">
          <svg className="h-4 w-4 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" />
          </svg>
          İstatistikler yükleniyor / gerekirse yeniden oluşturuluyor...
        </div>
      )}
      <h1 className="text-2xl font-semibold text-blue-600 mb-3">Takım Seçme</h1>
      <div className="flex flex-col lg:flex-row gap-3 w-full min-w-0">
        {/* Available Players Section */}
        <div className="lg:w-2/5 bg-white p-3 rounded-lg shadow border min-w-0">
          <h2 className="text-lg font-semibold mb-2 text-gray-700">Gelen Oyuncular ({availablePlayers.length})</h2>
          {renderAvailablePlayersList()}
          <div className="mt-4">
            <h2 className="text-lg font-semibold mb-2 text-gray-700">Harita İstatistikleri</h2>
            {renderMapStats()}
          </div>
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
          <MapSelection teamAName={teamAName || 'A'} teamBName={teamBName || 'B'} mapsState={mapsState} onMapsChange={() => { void refetchTeamPicker(); }} />
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
              <button
                className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-2 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setStopServerModalOpen(true)}
                disabled={stoppingServer}
              >
                {stoppingServer ? 'Kapatılıyor...' : 'Server Kapat'}
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
      {/* Server Kapat Modal */}
      {stopServerModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-xs">
            <h2 className="text-lg font-bold mb-4 text-gray-800">Server Kapatmak için Şifre</h2>
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
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded"
                onClick={async () => {
                  setStopServerModalOpen(false);
                  setServerPassword('');
                  await handleStopServer();
                }}
              >Onayla</button>
              <button
                className="flex-1 bg-gray-400 hover:bg-gray-500 text-white py-2 rounded"
                onClick={() => { setStopServerModalOpen(false); setServerPassword(''); }}
              >İptal</button>
            </div>
          </div>
        </div>
      )}
      {editingPlayer && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-2 text-gray-800">Oyuncu Stat Duzenle</h2>
            <p className="text-sm text-gray-600 mb-4">
              {editingPlayer.name} ({editingPlayer.steamId})
            </p>
            <div className="grid grid-cols-2 gap-3">
              {EDITABLE_STAT_KEYS.map((key) => (
                <label key={key} className="text-sm text-gray-700">
                  <div className="mb-1">{STAT_LABELS[key]}</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    className="w-full border px-2 py-1 rounded text-black"
                    value={editingStatsForm[key]}
                    onChange={(e) => handleEditStatInputChange(key, e.target.value)}
                    disabled={editStatsSaving}
                  />
                </label>
              ))}
            </div>
            {editStatsMessage && (
              <div className={`mt-3 text-sm ${editStatsMessage.includes('hata') ? 'text-red-600' : 'text-green-600'}`}>
                {editStatsMessage}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
                onClick={handleSaveEditedStats}
                disabled={editStatsSaving}
              >
                {editStatsSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
              <button
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded disabled:opacity-50"
                onClick={handleRevertEditedStats}
                disabled={editStatsSaving}
              >
                Varsayilana Don
              </button>
              <button
                className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded disabled:opacity-50"
                onClick={closeEditStatsModal}
                disabled={editStatsSaving}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Tiny hidden plugins trigger */}
      <button
        aria-label="Load plugins"
        title="Load plugins"
        onClick={handleLoadPlugins}
        className="fixed bottom-1 right-1 w-6 h-6 text-[10px] opacity-40 hover:opacity-80 bg-gray-200 text-gray-700 rounded-full shadow-sm flex items-center justify-center"
      >PL</button>
      {pluginsMessage && (
        <div className="fixed bottom-8 right-2 text-[11px] bg-white border rounded px-2 py-1 shadow text-gray-700">
          {pluginsMessage}
        </div>
      )}
    </div>
  );
};

export default TeamPickerClient;

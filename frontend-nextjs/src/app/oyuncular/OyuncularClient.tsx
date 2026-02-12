"use client";

import React, { useEffect, useMemo, useState } from "react";
import SteamAvatar from "@/components/SteamAvatar";
import { useTheme } from "@/contexts/ThemeContext";

type PlayerListItem = {
  name: string;
  steamId: string;
  status?: string;
};

type StatLine = {
  label: string;
  value: string | number;
};

type PeriodMeta = {
  id: string;
  label?: string;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
};

type PlayersStatsPeriodsPayload = {
  current_period?: string;
  periods?: PeriodMeta[];
  data?: Record<string, any[]>;
};

function buildFallbackPeriods(initialStats: any[]): PlayersStatsPeriodsPayload {
  return {
    current_period: "season_current",
    periods: [{ id: "season_current", label: "Guncel Sezon", is_current: true }],
    data: { season_current: Array.isArray(initialStats) ? initialStats : [] },
  };
}

function formatNumber(value: unknown, decimals = 1) {
  const n = Number(value);
  if (Number.isNaN(n)) return "-";
  return n.toFixed(decimals);
}

function formatInt(value: unknown) {
  const n = Number(value);
  if (Number.isNaN(n)) return "-";
  return Math.round(n).toString();
}

function formatPercent(value: unknown, decimals = 1) {
  const n = Number(value);
  if (Number.isNaN(n)) return "-";
  return `${n.toFixed(decimals)}%`;
}

function StatCard({
  title,
  value,
  lines,
  className = "",
}: {
  title: string;
  value: string | number;
  lines?: StatLine[];
  className?: string;
}) {
  return (
    <div
      className={`bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-lg shadow-sm p-4 ${className}`}
    >
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-semibold text-gray-800">{value}</div>
      {lines && lines.length > 0 && (
        <div className="mt-2 space-y-1 text-sm text-gray-600">
          {lines.map((line) => (
            <div key={`${title}-${line.label}`} className="flex items-center justify-between gap-2">
              <span>{line.label}</span>
              <span className="font-medium text-gray-800">{line.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatListCard({
  title,
  lines,
  className = "",
}: {
  title: string;
  lines: StatLine[];
  className?: string;
}) {
  return (
    <div
      className={`bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-lg shadow-sm p-4 ${className}`}
    >
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 space-y-1 text-sm text-gray-700">
        {lines.map((line) => (
          <div key={`${title}-${line.label}`} className="flex items-center justify-between gap-2">
            <span>{line.label}</span>
            <span className="text-gray-800">{line.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressBarRow({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: number;
  colorClass: string;
}) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="text-gray-800">{formatPercent(safeValue, 1)}</span>
      </div>
      <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass}`} style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function ClutchCard({
  title,
  data,
}: {
  title: string;
  data?: { total?: number; won?: number; lost?: number; avg_kills?: number; win_rate?: number; save_rate?: number };
}) {
  const total = Number(data?.total) || 0;
  const won = Number(data?.won) || 0;
  const lost = Number(data?.lost) || 0;
  const avgKills = Number(data?.avg_kills) || 0;
  const winRate = Number(data?.win_rate) || 0;
  const saveRate = Number(data?.save_rate) || 0;

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-lg shadow-sm p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-semibold text-gray-800 mt-1">{formatPercent(winRate, 1)}</div>
      <div className="mt-3 space-y-1 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          <span>Total</span>
          <span className="text-gray-800">{formatInt(total)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Won</span>
          <span className="text-gray-800">{formatInt(won)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Lost</span>
          <span className="text-gray-800">{formatInt(lost)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Avg Kill</span>
          <span className="text-gray-800">{formatNumber(avgKills, 1)}</span>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <ProgressBarRow label="Win rate" value={winRate} colorClass="bg-emerald-500" />
        <ProgressBarRow label="Save rate" value={saveRate} colorClass="bg-amber-500" />
      </div>
    </div>
  );
}

export default function OyuncularClient({
  initialStats,
  initialPeriods,
  playersList,
}: {
  initialStats: any[];
  initialPeriods?: PlayersStatsPeriodsPayload | null;
  playersList: PlayerListItem[];
}) {
  const [periodPayload, setPeriodPayload] = useState<PlayersStatsPeriodsPayload>(
    initialPeriods && initialPeriods.data ? initialPeriods : buildFallbackPeriods(initialStats || [])
  );
  const periodOptions = useMemo(
    () => (Array.isArray(periodPayload?.periods) && periodPayload.periods.length ? periodPayload.periods : []),
    [periodPayload]
  );
  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    periodPayload?.current_period || periodOptions[0]?.id || "season_current"
  );
  const stats = useMemo(() => {
    const rows = periodPayload?.data?.[selectedPeriod];
    return Array.isArray(rows) ? rows : [];
  }, [periodPayload, selectedPeriod]);
  const [loading, setLoading] = useState<boolean>(stats.length === 0);

  const tabs = useMemo(() => {
    if (Array.isArray(playersList) && playersList.length > 0) {
      const normalized = playersList.map((p) => ({
        steamId: String(p.steamId),
        name: p.name,
        status: p.status,
      }));
      const activeOnly = normalized.filter((p) => (p.status || "").toLocaleLowerCase("tr-TR") === "aktif oyuncu");
      return activeOnly.length > 0 ? activeOnly : normalized;
    }
    if (Array.isArray(stats) && stats.length > 0) {
      return stats.map((p) => ({
        steamId: String(p.steam_id),
        name: p.name,
        status: undefined as string | undefined,
      }));
    }
    return [] as { steamId: string; name: string; status?: string }[];
  }, [playersList, stats]);

  const [activeSteamId, setActiveSteamId] = useState<string>(tabs[0]?.steamId || "");

  useEffect(() => {
    const hasSelected = Array.isArray(periodPayload?.data?.[selectedPeriod]);
    if (!hasSelected) {
      setSelectedPeriod(periodPayload?.current_period || periodOptions[0]?.id || "season_current");
    }
  }, [periodPayload, periodOptions, selectedPeriod]);

  useEffect(() => {
    if (!activeSteamId || !tabs.find((tab) => tab.steamId === activeSteamId)) {
      setActiveSteamId(tabs[0]?.steamId || "");
    }
  }, [activeSteamId, tabs]);

  useEffect(() => {
    const lastKnownTs = typeof window !== "undefined" ? localStorage.getItem("stats_last_ts") : null;
    const url = `/api/stats/check${lastKnownTs ? `?lastKnownTs=${encodeURIComponent(lastKnownTs)}&` : "?"}_cb=${Date.now()}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.players_stats_periods?.data) {
          setPeriodPayload(j.players_stats_periods);
          if (j.players_stats_periods.current_period) {
            setSelectedPeriod(j.players_stats_periods.current_period);
          }
        } else if (Array.isArray(j.players_stats)) {
          const fallback = buildFallbackPeriods(j.players_stats);
          setPeriodPayload(fallback);
          setSelectedPeriod(fallback.current_period || "season_current");
        }
        if (j.serverTimestamp) {
          try {
            localStorage.setItem("stats_last_ts", j.serverTimestamp);
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statsById = useMemo(() => {
    const map = new Map<string, any>();
    if (Array.isArray(stats)) {
      stats.forEach((p) => {
        if (p?.steam_id) map.set(String(p.steam_id), p);
      });
    }
    return map;
  }, [stats]);

  const activeTab = tabs.find((tab) => tab.steamId === activeSteamId) || tabs[0];
  const selectedStats = activeTab ? statsById.get(activeTab.steamId) : null;
  const displayName = activeTab?.name || selectedStats?.name || "Oyuncu";

  const weapons = Array.isArray(selectedStats?.weapons) ? selectedStats.weapons : [];
  const clutches = selectedStats?.clutches || { overall: {}, by_type: {} };

  const clutchCards = [
    { key: "overall", label: "Overall", data: clutches.overall },
    { key: "1v1", label: "1v1", data: clutches.by_type?.["1v1"] },
    { key: "1v2", label: "1v2", data: clutches.by_type?.["1v2"] },
    { key: "1v3", label: "1v3", data: clutches.by_type?.["1v3"] },
    { key: "1v4", label: "1v4", data: clutches.by_type?.["1v4"] },
    { key: "1v5", label: "1v5", data: clutches.by_type?.["1v5"] },
  ];

  const matchesPlayed = Number(selectedStats?.matches_played) || 0;
  const perMatch = (value: number) => (matchesPlayed > 0 ? value / matchesPlayed : 0);
  const { isDark } = useTheme();
  const tabRows = useMemo(() => {
    if (tabs.length <= 1) return [tabs];
    const mid = Math.ceil(tabs.length / 2);
    return [tabs.slice(0, mid), tabs.slice(mid)];
  }, [tabs]);

  return (
    <div className="space-y-6">
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <label htmlFor="oyuncular-period-selector" className="block text-sm font-medium text-gray-700 mb-1">Donem Secin:</label>
        <select
          id="oyuncular-period-selector"
          className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
        >
          {periodOptions.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label || period.id}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-gray-100 border border-gray-200 rounded-lg p-2 space-y-2">
        {tabRows.map((row, rowIndex) => (
          <div
            key={`tab-row-${rowIndex}`}
            className="flex flex-nowrap sm:flex-wrap items-center justify-start sm:justify-center gap-2 overflow-x-auto sm:overflow-visible px-1"
          >
            {row.map((tab) => (
              <button
                key={tab.steamId}
                className={`map-tab-button tab-nav-item ${tab.steamId === activeSteamId ? "active" : ""} flex items-center gap-2`}
                onClick={() => setActiveSteamId(tab.steamId)}
                type="button"
              >
                <SteamAvatar 
                  steamId={tab.steamId} 
                  playerName={tab.name} 
                  size="small" 
                  showLink={false}
                  className="flex-shrink-0"
                />
                <span>{tab.name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="relative">
        {loading && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center text-sm z-10 ${isDark ? 'bg-[#0d1321]/70 text-gray-300' : 'bg-white/70 text-gray-600'}`}>
            <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2" />
            Oyuncu istatistikleri yükleniyor...
          </div>
        )}

        {!selectedStats ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
            Bu oyuncu icin donem verisi bulunamadi.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-2">
                <div className="bg-gradient-to-br from-white to-blue-50 border border-slate-200 rounded-lg shadow-sm p-4 flex flex-col items-center text-center">
                  <SteamAvatar 
                    steamId={activeTab?.steamId || ""} 
                    playerName={displayName} 
                    size="large"
                    showLink={true}
                  />
                  <div className="mt-3 text-lg font-semibold text-gray-800">{displayName}</div>
                  {activeTab?.status && (
                    <div className="mt-1 text-xs text-gray-500">{activeTab.status}</div>
                  )}
                  <div className="mt-2 text-xs text-gray-400">Steam ID: {activeTab?.steamId}</div>
                </div>
              </div>

              <div className="xl:col-span-10 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <StatCard
                  title="Win Ratio"
                  value={formatPercent(selectedStats.win_rate, 1)}
                  lines={[
                    { label: "Maç", value: formatInt(selectedStats.matches_played) },
                    { label: "Win", value: formatInt(selectedStats.wins) },
                    { label: "Tie", value: formatInt(selectedStats.ties) },
                    { label: "Loss", value: formatInt(selectedStats.losses) },
                  ]}
                  className="from-blue-50 to-white"
                />
                <StatCard title="KAST" value={formatPercent(selectedStats.kast, 1)} />
                <StatCard title="K/D" value={formatNumber(selectedStats.kd, 2)} />
                <StatCard title="Avg Kills/Round" value={formatNumber(selectedStats.avg_kills_per_round, 2)} />
                <StatCard title="Avg Death/Round" value={formatNumber(selectedStats.avg_deaths_per_round, 2)} />
                <StatCard title="HS %" value={formatPercent(selectedStats.hs_pct, 1)} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4">
                  <StatCard
                    title="HLTV 2.0"
                    value={formatNumber(selectedStats.hltv_2, 2)}
                    className="xl:col-span-2"
                  />
                  <StatCard title="ADR" value={formatNumber(selectedStats.adr, 1)} className="xl:col-span-2" />
                  <StatListCard
                    title="Kills (Toplam)"
                    lines={[
                      { label: "Kills", value: formatInt(selectedStats.kills) },
                      { label: "Deaths", value: formatInt(selectedStats.deaths) },
                      { label: "Assists", value: formatInt(selectedStats.assists) },
                      { label: "Headshots", value: formatInt(selectedStats.headshots) },
                      { label: "Wallbang K", value: formatInt(selectedStats.wallbang_kills) },
                      { label: "Collateral K", value: formatInt(selectedStats.collateral_kills) },
                    ]}
                    className="xl:col-span-4 from-emerald-50 to-white"
                  />
                  <StatListCard
                    title="Maç Başı"
                    lines={[
                      { label: "Kills", value: formatNumber(perMatch(Number(selectedStats.kills) || 0), 1) },
                      { label: "Deaths", value: formatNumber(perMatch(Number(selectedStats.deaths) || 0), 1) },
                      { label: "Assists", value: formatNumber(perMatch(Number(selectedStats.assists) || 0), 1) },
                      { label: "Headshots", value: formatNumber(perMatch(Number(selectedStats.headshots) || 0), 1) },
                      { label: "Wallbang K", value: formatNumber(perMatch(Number(selectedStats.wallbang_kills) || 0), 1) },
                      { label: "Collateral K", value: formatNumber(perMatch(Number(selectedStats.collateral_kills) || 0), 1) },
                    ]}
                    className="xl:col-span-4 from-amber-50 to-white"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4">
                  <StatListCard
                    title="Utilities"
                    lines={[
                      { label: "Avg Blind Time", value: `${formatNumber(selectedStats.utilities?.avg_blind_time, 1)}s` },
                      { label: "Enemies Flashed", value: formatNumber(selectedStats.utilities?.enemies_flashed, 1) },
                      { label: "Avg HE Damage", value: formatNumber(selectedStats.utilities?.avg_he_damage, 1) },
                      { label: "Avg Smokes", value: formatNumber(selectedStats.utilities?.avg_smokes_thrown, 1) },
                    ]}
                    className="xl:col-span-3 from-sky-50 to-white"
                  />
                  <StatListCard
                    title="Opening Duels"
                    lines={[
                      { label: "Success", value: formatPercent(selectedStats.opening_duels?.success_pct, 1) },
                      { label: "Traded", value: formatPercent(selectedStats.opening_duels?.traded_pct, 1) },
                      { label: "Best Weapon", value: selectedStats.opening_duels?.best_weapon || "-" },
                    ]}
                    className="xl:col-span-3"
                  />
                  <StatListCard
                    title="Rounds"
                    lines={[
                      { label: "Total", value: formatInt(selectedStats.rounds?.total) },
                      { label: "CT", value: formatInt(selectedStats.rounds?.ct) },
                      { label: "T", value: formatInt(selectedStats.rounds?.t) },
                    ]}
                    className="xl:col-span-3"
                  />
                  <StatListCard
                    title="Multi Kills"
                    lines={[
                      { label: "5K", value: formatInt(selectedStats.multi_kills?.k5) },
                      { label: "4K", value: formatInt(selectedStats.multi_kills?.k4) },
                      { label: "3K", value: formatInt(selectedStats.multi_kills?.k3) },
                      { label: "2K", value: formatInt(selectedStats.multi_kills?.k2) },
                      { label: "1K", value: formatInt(selectedStats.multi_kills?.k1) },
                    ]}
                    className="xl:col-span-3"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4">
                  <StatListCard
                    title="Weapon Inspections"
                    lines={[
                      { label: "Total", value: formatInt(selectedStats.inspections?.total) },
                      { label: "Deaths While Inspecting", value: formatInt(selectedStats.inspections?.deaths_while_inspecting) },
                    ]}
                    className="xl:col-span-6"
                  />
                  <StatListCard
                    title="Objectives"
                    lines={[
                      { label: "Plant", value: formatInt(selectedStats.objectives?.bomb_planted) },
                      { label: "Defuse", value: formatInt(selectedStats.objectives?.bomb_defused) },
                      { label: "Hostage", value: formatInt(selectedStats.objectives?.hostage_rescued) },
                    ]}
                    className="xl:col-span-6"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
              <div className="text-lg font-semibold text-gray-800 mb-3">Weapons</div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Kills</th>
                      <th className="py-2 pr-4">HS %</th>
                      <th className="py-2 pr-4">Damage</th>
                      <th className="py-2 pr-4">Shots</th>
                      <th className="py-2 pr-4">Hits</th>
                      <th className="py-2">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weapons.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-gray-500">
                          Silah verisi bulunamadı.
                        </td>
                      </tr>
                    ) : (
                      weapons.map((w: any) => (
                        <tr key={w.name} className="border-b last:border-b-0">
                          <td className="py-2 pr-4 font-medium text-gray-800">{w.name}</td>
                          <td className="py-2 pr-4">{formatInt(w.kills)}</td>
                          <td className="py-2 pr-4">{formatPercent(w.hs_pct, 0)}</td>
                          <td className="py-2 pr-4">{formatInt(w.damage)}</td>
                          <td className="py-2 pr-4">{formatInt(w.shots)}</td>
                          <td className="py-2 pr-4">{formatInt(w.hits)}</td>
                          <td className="py-2">{formatPercent(w.accuracy, 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
              <div className="text-lg font-semibold text-gray-800 mb-3">Clutches</div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {clutchCards.map((entry) => (
                  <ClutchCard key={entry.key} title={entry.label} data={entry.data} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

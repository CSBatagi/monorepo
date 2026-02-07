"use client";

import { useMemo, useState } from "react";
import AwardsListClient from "./AwardsListClient";
import { buildSeasonWindowOptions, filterDataBySeason } from "@/lib/seasonRanges";
import { useTheme } from "@/contexts/ThemeContext";

interface PlayerAward {
  name: string;
  totalHltvDiff: number;
  totalAdrDiff: number;
  gameCount: number;
  performanceScore: number;
  avgHltvDiff: number;
  avgAdrDiff: number;
}

interface Awards {
  top3: PlayerAward[];
  bottom3: PlayerAward[];
}

type MonthPeriod = {
  key: string;
  label: string;
};

const MONTHS_TR = [
  "Ocak",
  "Subat",
  "Mart",
  "Nisan",
  "Mayis",
  "Haziran",
  "Temmuz",
  "Agustos",
  "Eylul",
  "Ekim",
  "Kasim",
  "Aralik",
];

function getMonthPeriods(data: Record<string, any[]>): MonthPeriod[] {
  const monthKeys = new Set<string>();
  for (const dateStr of Object.keys(data || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    monthKeys.add(dateStr.slice(0, 7));
  }
  return [...monthKeys]
    .sort()
    .map((key) => {
      const [y, m] = key.split("-");
      const year = Number(y);
      const month = Number(m) - 1;
      const monthName = MONTHS_TR[month] || key;
      return { key, label: `${monthName} ${year}` };
    });
}

function calculateAwardsByMonth(allData: Record<string, any[]>, monthKey: string): Awards {
  const playerGames: Record<string, Array<{ name: string; hltv2Diff: number; adrDiff: number }>> = {};
  for (const [dateStr, rows] of Object.entries(allData || {})) {
    if (!dateStr.startsWith(`${monthKey}-`) || !Array.isArray(rows)) continue;
    for (const playerStats of rows) {
      const steamId = playerStats?.steam_id;
      if (!steamId) continue;
      const hltv2 = parseFloat(playerStats?.["HLTV 2"]) || 0;
      const adr = parseFloat(playerStats?.["ADR"]) || 0;
      const hltv2Diff = parseFloat(playerStats?.["HLTV2 DIFF"]) || 0;
      const adrDiff = parseFloat(playerStats?.["ADR DIFF"]) || 0;
      if (hltv2Diff === hltv2 && adrDiff === adr) continue;
      if (!playerGames[steamId]) playerGames[steamId] = [];
      playerGames[steamId].push({
        name: playerStats?.name || String(steamId),
        hltv2Diff,
        adrDiff,
      });
    }
  }

  const aggregated = Object.values(playerGames)
    .map((games) => {
      if (!games.length) return null;
      const name = games[0].name;
      const totalHltvDiff = games.reduce((sum, g) => sum + g.hltv2Diff, 0);
      const totalAdrDiff = games.reduce((sum, g) => sum + g.adrDiff, 0);
      const avgHltvDiff = totalHltvDiff / games.length;
      const avgAdrDiff = totalAdrDiff / games.length;
      return {
        name,
        totalHltvDiff,
        totalAdrDiff,
        gameCount: games.length,
        performanceScore: avgHltvDiff * 70 + avgAdrDiff,
        avgHltvDiff,
        avgAdrDiff,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.performanceScore - a.performanceScore) as PlayerAward[];

  return {
    top3: aggregated.slice(0, 3),
    bottom3: aggregated.slice(-3).reverse(),
  };
}

export default function PerformansOdulleriClient({
  allData,
  seasonStarts,
}: {
  allData: Record<string, any[]>;
  seasonStarts: string[];
}) {
  const allDates = useMemo(() => Object.keys(allData || {}).sort(), [allData]);
  const seasonOptions = useMemo(() => buildSeasonWindowOptions(seasonStarts || [], allDates), [seasonStarts, allDates]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(seasonOptions[0]?.id || "all_time");
  const selectedSeason = useMemo(
    () => seasonOptions.find((s) => s.id === selectedSeasonId) || seasonOptions[0] || { id: "all_time", label: "Tum Zamanlar", startDate: null, endDate: null },
    [seasonOptions, selectedSeasonId]
  );
  const scopedData = useMemo(() => filterDataBySeason(allData || {}, selectedSeason), [allData, selectedSeason]);
  const monthPeriods = useMemo(() => getMonthPeriods(scopedData), [scopedData]);
  const awardsByPeriod = useMemo(
    () => monthPeriods.map((period) => ({ period, awards: calculateAwardsByMonth(scopedData, period.key) })).reverse(),
    [monthPeriods, scopedData]
  );
  const { isDark } = useTheme();

  return (
    <div className="space-y-6">
      <div className={`mb-4 p-4 border rounded-lg shadow-sm ${isDark ? 'bg-dark-surface border-dark-border' : 'bg-gray-50'}`}>
        <label htmlFor="performans-odulleri-season-selector" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Donem Secin:</label>
        <select
          id="performans-odulleri-season-selector"
          className={`form-select block w-full mt-1 rounded-md shadow-sm focus:ring focus:ring-opacity-50 ${isDark ? 'bg-dark-card border-dark-border text-gray-100 focus:border-blue-500 focus:ring-blue-500/20' : 'border-gray-300 focus:border-indigo-300 focus:ring-indigo-200'}`}
          value={selectedSeasonId}
          onChange={(e) => setSelectedSeasonId(e.target.value)}
        >
          {seasonOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>

      {awardsByPeriod.length === 0 && (
        <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>Hic veri bulunamadi.</p>
      )}

      {awardsByPeriod.length > 0 && (
        <div className="space-y-8">
          {awardsByPeriod.map(({ period, awards }) => (
            <div key={period.key} className={`border rounded-lg shadow-none p-4 ${isDark ? 'bg-dark-card border-dark-border' : 'bg-white'}`}>
              <h3 className={`text-2xl font-bold mb-4 ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>Donem: {period.label}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h4 className={`text-xl font-bold mb-3 ${isDark ? 'text-green-400' : 'text-green-700'}`}>En Iyi Performans Gosterenler (Top 3)</h4>
                  {awards.top3.length === 0 ? (
                    <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>Bu donem icin en iyi performans gosteren oyuncu bulunmuyor.</p>
                  ) : (
                    <AwardsListClient players={awards.top3} color="green" />
                  )}
                </div>
                <div>
                  <h4 className={`text-xl font-bold mb-3 ${isDark ? 'text-red-400' : 'text-red-700'}`}>En Dusuk Performans Gosterenler (Bottom 3)</h4>
                  {awards.bottom3.length === 0 ? (
                    <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>Bu donem icin en dusuk performans gosteren oyuncu bulunmuyor.</p>
                  ) : (
                    <AwardsListClient players={awards.bottom3} color="red" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

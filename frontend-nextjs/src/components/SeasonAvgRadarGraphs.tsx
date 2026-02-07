"use client";
import React, { useState, useMemo } from "react";
import { Radar } from "react-chartjs-2";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

function calculateStatRanges(players: any[], statKeys: string[]) {
  const ranges: Record<string, { min: number; max: number }> = {};
  statKeys.forEach((stat) => {
    ranges[stat] = { min: Infinity, max: -Infinity };
  });
  players.forEach((player) => {
    statKeys.forEach((stat) => {
      const value = player[stat];
      if (typeof value === "number" && !isNaN(value)) {
        if (value < ranges[stat].min) ranges[stat].min = value;
        if (value > ranges[stat].max) ranges[stat].max = value;
      }
    });
  });
  statKeys.forEach((stat) => {
    if (!isFinite(ranges[stat].min)) {
      ranges[stat].min = 0;
      ranges[stat].max = 1.5;
    } else if (ranges[stat].min === ranges[stat].max) {
      const val = ranges[stat].min;
      const buffer = Math.abs(val * 0.1) || 0.1;
      ranges[stat].min = val - buffer;
      ranges[stat].max = val + buffer;
      if (val >= 0 && ranges[stat].min < 0) ranges[stat].min = 0;
    }
  });
  return ranges;
}

function normalizeStat(value: number, stat: string, allStatRanges: Record<string, { min: number; max: number }>) {
  const range = allStatRanges[stat];
  if (!range || range.max === range.min || typeof value !== "number" || isNaN(value)) {
    return 0;
  }
  const normalized = ((value - range.min) / (range.max - range.min)) * 100;
  return Math.max(0, Math.min(100, normalized));
}

export function RadarGraphs({ data, statConfig, playerFilterKey = "matches", title = "Pentagon İstatistiklerini Özelleştir" }: {
  data: any[];
  statConfig: Record<string, { label: string; default: boolean; format?: string }>;
  playerFilterKey?: string;
  title?: string;
}) {
  const PENTAGON_STAT_LIMIT = 5;
  const { isDark } = useTheme();
  const defaultSelected = Object.entries(statConfig)
    .filter(([_, v]) => v.default)
    .map(([k]) => k)
    .slice(0, PENTAGON_STAT_LIMIT);
  const [selectedStats, setSelectedStats] = useState<string[]>(defaultSelected);
  const [validationMsg, setValidationMsg] = useState<string>("");
  const [updateTrigger, setUpdateTrigger] = useState(0);

  function handleStatChange(stat: string, checked: boolean) {
    let next = checked
      ? [...selectedStats, stat]
      : selectedStats.filter((s) => s !== stat);
    if (next.length > PENTAGON_STAT_LIMIT) {
      setValidationMsg(`En fazla ${PENTAGON_STAT_LIMIT} istatistik seçebilirsiniz.`);
      return;
    }
    setValidationMsg("");
    setSelectedStats(next);
  }

  function handleUpdateGraphs() {
    if (selectedStats.length !== PENTAGON_STAT_LIMIT) {
      setValidationMsg(`Tam olarak ${PENTAGON_STAT_LIMIT} istatistik seçmelisiniz.`);
      return;
    }
    setValidationMsg("");
    setUpdateTrigger((n) => n + 1);
  }

  const statRanges = useMemo(() => calculateStatRanges(data, selectedStats), [data, selectedStats, updateTrigger]);
  const playerCards = useMemo(() => {
    if (selectedStats.length !== PENTAGON_STAT_LIMIT) return null;
    return data
      .filter((p) => typeof p[playerFilterKey] === "number" && p[playerFilterKey] > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((player) => {
        const chartId = `radar-chart-${player.name.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const statLabels = selectedStats.map((k) => statConfig[k].label);
        const rawValues = selectedStats.map((k) => player[k]);
        const normalized = selectedStats.map((k) => normalizeStat(player[k], k, statRanges));
        const chartData = {
          labels: statLabels,
          datasets: [
            {
              label: `${player.name}`,
              data: normalized,
              backgroundColor: "rgba(54, 162, 235, 0.2)",
              borderColor: "rgb(54, 162, 235)",
              pointBackgroundColor: "rgb(54, 162, 235)",
              pointBorderColor: "#fff",
              pointHoverBackgroundColor: "#fff",
              pointHoverBorderColor: "rgb(54, 162, 235)",
              borderWidth: 1.5,
              pointRadius: 2,
              pointHoverRadius: 4,
            },
          ],
        };
        const chartOptions = {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: true,
              callbacks: {
                label: function (context: any) {
                  const statKey = selectedStats[context.dataIndex];
                  const raw = rawValues[context.dataIndex];
                  const config = statConfig[statKey];
                  let formatted = "N/A";
                  if (typeof raw === "number" && !isNaN(raw)) {
                    if (config?.format === "percent") formatted = raw.toFixed(1) + "%";
                    else if (config?.format === "decimal2") formatted = raw.toFixed(2);
                    else if (config?.format === "decimal1") formatted = raw.toFixed(1);
                    else formatted = (raw % 1 === 0) ? raw.toFixed(0) : raw.toFixed(2);
                  }
                  return `${context.label}: ${formatted}`;
                },
              },
            },
          },
          scales: {
            r: {
              angleLines: {
                display: true,
                lineWidth: 0.5,
                color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.4)",
              },
              suggestedMin: 0,
              suggestedMax: 100,
              ticks: { display: false, stepSize: 25, backdropColor: "rgba(0,0,0,0)" },
              pointLabels: {
                font: { size: 11, weight: 700 },
                color: isDark ? "#e5e7eb" : "#1f2937",
              },
              grid: {
                color: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.3)",
                lineWidth: 0.5,
              },
            },
          },
          layout: { padding: 5 },
        };
        return (
          <div key={player.steam_id} className={`player-card border rounded-lg shadow p-3 flex flex-col items-center text-center ${isDark ? 'bg-dark-card border-dark-border' : 'bg-white'}`}>
            <span className={`text-base font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{player.name}</span>
            <div className="w-full flex justify-center">
              <div className="w-[200px] h-[192px]">
                <Radar data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        );
      });
  }, [data, selectedStats, statRanges, updateTrigger, statConfig, playerFilterKey]);

  return (
    <div>
      {/* Stat Selection UI */}
      <div className={`mb-6 p-4 border rounded-lg shadow-sm ${isDark ? 'bg-dark-surface border-dark-border' : 'bg-gray-50'}`}>
        <div className="flex justify-between items-center cursor-pointer select-none" onClick={() => {
          const el = document.getElementById("radar-stat-selector-content");
          if (el) el.classList.toggle("hidden");
          const arrow = document.getElementById("radar-stat-arrow");
          if (arrow) arrow.classList.toggle("rotate-180");
        }}>
          <h3 className={`text-lg font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{title}</h3>
          <svg id="radar-stat-arrow" className="w-5 h-5 text-gray-500 transform transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
        <div id="radar-stat-selector-content" className="mt-2 hidden">
          <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Grafikte göstermek için tam olarak 5 istatistik seçin:</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-2 mb-4">
            {Object.entries(statConfig).map(([key, config]) => (
              <label key={key} className="inline-flex items-center">
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 radar-pentagon-stat-option"
                  checked={selectedStats.includes(key)}
                  onChange={e => handleStatChange(key, e.target.checked)}
                  disabled={selectedStats.length === PENTAGON_STAT_LIMIT && !selectedStats.includes(key)}
                />
                <span className={`ml-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{config.label}</span>
              </label>
            ))}
          </div>
          <div className="text-sm text-red-600 h-4 mb-3">{validationMsg}</div>
          <button
            className={`action-button px-4 py-2 rounded bg-blue-600 text-white font-semibold shadow hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            disabled={selectedStats.length !== PENTAGON_STAT_LIMIT}
            onClick={handleUpdateGraphs}
          >
            Grafikleri Güncelle
          </button>
        </div>
      </div>
      {/* Player Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {selectedStats.length !== PENTAGON_STAT_LIMIT ? (
          <div className="text-center py-8 text-gray-500 col-span-full">5 istatistik seçin ve "Grafikleri Güncelle"ye tıklayın.</div>
        ) : playerCards && playerCards.length > 0 ? playerCards : (
          <div className={`text-center py-8 col-span-full ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Veri yok.</div>
        )}
      </div>
    </div>
  );
}

// For backward compatibility
const SELECTABLE_STATS: Record<string, { label: string; default: boolean; format?: string }> = {
  hltv_2: { label: "HLTV 2.0", default: true },
  adr: { label: "ADR", default: true },
  kd: { label: "K/D", default: true },
  hs_ratio: { label: "HS/Kill %", default: true, format: "percent" },
  win_rate: { label: "Win Rate %", default: true, format: "percent" },
  kast: { label: "KAST", default: false, format: "percent" },
  utl_dmg: { label: "Utility Dmg", default: false },
  first_kill: { label: "First Kill Avg", default: false },
  clutch_success: { label: "Clutch Win %", default: false, format: "percent" },
  assists: { label: "Assists Avg", default: false },
};

export default function SeasonAvgRadarGraphs({ data }: { data: any[] }) {
  return <RadarGraphs data={data} statConfig={SELECTABLE_STATS} playerFilterKey="matches" title="Pentagon İstatistiklerini Özelleştir" />;
}
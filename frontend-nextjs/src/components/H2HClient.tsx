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
      ranges[stat].max = 100;
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

function formatValue(value: any, col: any) {
  if (value === undefined || value === null) return "-";
  if (col.isPercentage) return `${Number(value).toFixed(col.decimals ?? 1)}%`;
  if (col.decimals !== undefined) return Number(value).toFixed(col.decimals);
  return value;
}

export default function H2HClient({ data, columns, matchesKey = "matches" }: { data: any[]; columns: any[]; matchesKey?: string }) {
  const { isDark } = useTheme();
  const players = useMemo(() =>
    data.filter((p) => typeof p[matchesKey] === "number" && p[matchesKey] > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [data, matchesKey]
  );
  const statOptions = useMemo(() => columns.filter((c) => c.key !== "name"), [columns]);
  const [player1, setPlayer1] = useState<string>("");
  const [player2, setPlayer2] = useState<string>("");
  const [selectedStats, setSelectedStats] = useState<string[]>(statOptions.slice(0, 5).map((c) => c.key));
  const [validationMsg, setValidationMsg] = useState<string>("");

  // Prevent selecting the same player
  const player1Obj = players.find((p) => p.steam_id === player1);
  const player2Obj = players.find((p) => p.steam_id === player2);

  // Stat selection logic
  function handleStatChange(stat: string, checked: boolean) {
    let next = checked ? [...selectedStats, stat] : selectedStats.filter((s) => s !== stat);
    if (next.length > 5) return;
    setSelectedStats(next);
  }

  // Validation
  const canCompare = player1 && player2 && player1 !== player2 && selectedStats.length === 5;

  // Stat ranges for normalization
  const statRanges = useMemo(() => calculateStatRanges(players, selectedStats), [players, selectedStats]);

  // Chart data
  const chartData = useMemo(() => {
    if (!canCompare || !player1Obj || !player2Obj) return null;
    const statLabels = selectedStats.map((k) => statOptions.find((c) => c.key === k)?.label || k);
    const p1Raw = selectedStats.map((k) => player1Obj[k]);
    const p2Raw = selectedStats.map((k) => player2Obj[k]);
    const p1Norm = selectedStats.map((k) => normalizeStat(player1Obj[k], k, statRanges));
    const p2Norm = selectedStats.map((k) => normalizeStat(player2Obj[k], k, statRanges));
    return {
      labels: statLabels,
      datasets: [
        {
          label: player1Obj.name,
          data: p1Norm,
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
        {
          label: player2Obj.name,
          data: p2Norm,
          backgroundColor: "rgba(255, 99, 132, 0.2)",
          borderColor: "rgb(255, 99, 132)",
          pointBackgroundColor: "rgb(255, 99, 132)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgb(255, 99, 132)",
          borderWidth: 1.5,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
      rawValues: [p1Raw, p2Raw],
    };
  }, [canCompare, player1Obj, player2Obj, selectedStats, statRanges, statOptions]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        labels: {
          color: isDark ? "#e5e7eb" : "#1f2937",
          boxWidth: 12,
          padding: 10,
          font: { size: 12 },
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: function (context: any) {
            const statKey = selectedStats[context.dataIndex];
            const col = statOptions.find((c) => c.key === statKey);
            const playerIdx = context.datasetIndex;
            const raw = chartData?.rawValues?.[playerIdx]?.[context.dataIndex];
            let formatted = "N/A";
            if (typeof raw === "number" && !isNaN(raw)) {
              if (col?.isPercentage) formatted = Number(raw).toFixed(col.decimals ?? 1) + "%";
              else if (col?.decimals !== undefined) formatted = Number(raw).toFixed(col.decimals);
              else formatted = String(raw);
            }
            return `${context.dataset.label} - ${context.label}: ${formatted}`;
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
          font: { size: 12, weight: 700 },
          color: isDark ? "#e5e7eb" : "#1f2937",
        },
        grid: {
          color: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.3)",
          lineWidth: 0.5,
        },
      },
    },
    layout: { padding: 10 },
  }), [selectedStats, statOptions, chartData, isDark]);

  // Reset player selection when player list changes (e.g., on date change)
  React.useEffect(() => {
    setPlayer1("");
    setPlayer2("");
  }, [players.length]);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Player Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label htmlFor="season-avg-h2h-player1-select" className={`block mb-2 text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-900'}`}>Oyuncu 1'i Seçin</label>
          <select
            id="season-avg-h2h-player1-select"
            className={`text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${isDark ? 'bg-dark-card border border-dark-border text-gray-100' : 'bg-gray-50 border border-gray-300 text-gray-900'}`}
            value={player1}
            onChange={e => setPlayer1(e.target.value)}
          >
            <option value="" disabled>Oyuncu 1'i Seçin</option>
            {players.map((p) => (
              <option key={p.steam_id} value={String(p.steam_id)} disabled={String(p.steam_id) === player2}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="season-avg-h2h-player2-select" className={`block mb-2 text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-900'}`}>Oyuncu 2'yi Seçin</label>
          <select
            id="season-avg-h2h-player2-select"
            className={`text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${isDark ? 'bg-dark-card border border-dark-border text-gray-100' : 'bg-gray-50 border border-gray-300 text-gray-900'}`}
            value={player2}
            onChange={e => setPlayer2(e.target.value)}
          >
            <option value="" disabled>Oyuncu 2'yi Seçin</option>
            {players.map((p) => (
              <option key={p.steam_id} value={String(p.steam_id)} disabled={String(p.steam_id) === player1}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>
      {/* Stat Selection */}
      <div className={`mb-4 p-4 border rounded-lg shadow-sm ${isDark ? 'bg-dark-surface border-dark-border' : 'bg-gray-50'}`}>
        <div className={`font-semibold mb-2 ${isDark ? 'text-gray-200' : ''}`}>Karşılaştırmak için 5 istatistik seçin:</div>
        <div className="flex flex-wrap gap-2">
          {statOptions.map((col) => (
            <label key={col.key} className="inline-flex items-center mr-4 mb-2">
              <input
                type="checkbox"
                className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                checked={selectedStats.includes(col.key)}
                onChange={e => handleStatChange(col.key, e.target.checked)}
                disabled={!selectedStats.includes(col.key) && selectedStats.length >= 5}
              />
              <span className={`ml-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{col.label}</span>
            </label>
          ))}
        </div>
        <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Tam olarak 5 istatistik seçilmelidir.</div>
      </div>
      {/* Validation Message */}
      {(!canCompare || validationMsg) && (
        <div className="text-center text-orange-600 font-medium mb-4 min-h-[24px]">{validationMsg || "Farklı iki oyuncu ve 5 istatistik seçin."}</div>
      )}
      {/* Chart */}
      <div className="mb-6 flex justify-center items-center min-h-[400px]">
        {canCompare && chartData ? (
          <div className="w-full max-w-md h-[400px]">
            <Radar data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className={`text-center py-8 col-span-full ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Karşılaştırma grafiğini görmek için iki oyuncu ve 5 istatistik seçin.</div>
        )}
      </div>
    </div>
  );
} 
"use client";
import { useState, useMemo } from "react";
import SteamAvatar from "@/components/SteamAvatar";
import { useTheme } from "@/contexts/ThemeContext";

export const columns = [
  { key: "name", label: "Oyuncu" },
  { key: "hltv_2", label: "HLTV2", decimals: 2, isBadge: true, heatmap: true },
  { key: "adr", label: "ADR", decimals: 1, isBadge: true, heatmap: true },
  { key: "kd", label: "K/D", decimals: 2, isBadge: true, heatmap: true },
  { key: "mvp", label: "MVP", decimals: 2 },
  { key: "kills", label: "Kills", decimals: 1 },
  { key: "deaths", label: "Deaths", decimals: 1 },
  { key: "assists", label: "Assists", decimals: 1 },
  { key: "hs", label: "HS", decimals: 1 },
  { key: "hs_ratio", label: "HS/Kill ratio", decimals: 1, isPercentage: true },
  { key: "first_kill", label: "First Kill", decimals: 1 },
  { key: "first_death", label: "First Death", decimals: 1 },
  { key: "bomb_planted", label: "Bomb Planted", decimals: 1 },
  { key: "bomb_defused", label: "Bomb Defused", decimals: 1 },
  { key: "hltv", label: "HLTV", decimals: 2 },
  { key: "kast", label: "KAST", decimals: 1, isPercentage: true },
  { key: "utl_dmg", label: "Utility Damage", decimals: 1 },
  { key: "two_kills", label: "2 kills", decimals: 1 },
  { key: "three_kills", label: "3 kills", decimals: 1 },
  { key: "four_kills", label: "4 kills", decimals: 1 },
  { key: "five_kills", label: "5 kills", decimals: 1 },
  { key: "matches", label: "Nr of Matches", decimals: 0 },
  { key: "win_rate", label: "WIN RATE (%)", decimals: 1, isPercentage: true },
  { key: "avg_clutches", label: "Nr of clutches per game", decimals: 2 },
  { key: "avg_clutches_won", label: "Clutches Won", decimals: 1 },
  { key: "clutch_success", label: "Successful Clutch (%)", decimals: 1, isPercentage: true },
];

function formatValue(value: any, col: any) {
  if (value === undefined || value === null) return "-";
  if (col.isPercentage) return `${Number(value).toFixed(col.decimals ?? 1)}%`;
  if (col.decimals !== undefined) return Number(value).toFixed(col.decimals);
  return value;
}

function getSortType(key: string) {
  // Only 'name' is string, rest are numbers
  return key === "name" ? "string" : "number";
}

// Utility: interpolate red-yellow-green
function getHeatmapColor(value: number, min: number, max: number): string {
  if (isNaN(value) || min === max) return "#eee";
  // Normalize value to 0-1
  let t = (value - min) / (max - min);
  t = Math.max(0, Math.min(1, t));
  // Red (220,38,38) -> Yellow (255,221,51) -> Green (0,128,0)
  if (t < 0.5) {
    // Red to Yellow
    const ratio = t / 0.5;
    const r = Math.round(220 + (255 - 220) * ratio);
    const g = Math.round(38 + (221 - 38) * ratio);
    const b = Math.round(38 + (51 - 38) * ratio);
    return `rgb(${r},${g},${b})`;
  } else {
    // Yellow to Green
    const ratio = (t - 0.5) / 0.5;
    const r = Math.round(255 + (0 - 255) * ratio);
    const g = Math.round(221 + (128 - 221) * ratio);
    const b = Math.round(51 + (0 - 51) * ratio);
    return `rgb(${r},${g},${b})`;
  }
}

export default function SeasonStatsTable({ data, columns: customColumns, tableClassName, loading }: { data: any[] | null | Record<string, any>, columns?: any[], tableClassName?: string, loading?: boolean }) {
  const cols = customColumns || columns;
  const [sortKey, setSortKey] = useState<string>(cols[1]?.key || "hltv_2");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { isDark } = useTheme();

  // If data accidentally arrives as an object (map) convert to array heuristically
  let normalized: any[] | null = data as any[] | null;
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const values = Object.values(data);
    if (values.length && Array.isArray(values[0])) {
      // Flatten first level arrays (choose first set) – caller should pass correct slice, but avoid crash
      normalized = values[0] as any[];
    } else {
      normalized = values as any[];
    }
  }
  data = normalized;

  // Compute min/max for heatmap columns
  const heatmapStats = useMemo(() => {
    const stats: Record<string, { min: number; max: number }> = {};
  if (!Array.isArray(data) || data.length === 0) return stats;
    cols.forEach((col) => {
      if (col.heatmap) {
        let min = Infinity, max = -Infinity;
  for (const row of data as any[]) {
          const v = Number(row[col.key]);
          if (!isNaN(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        stats[col.key] = { min, max };
      }
    });
    return stats;
  }, [data, cols]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 6 }).map((_,i) => (
          <div key={i} className={`h-4 rounded w-full ${isDark ? 'bg-dark-border' : 'bg-gray-200'}`} />
        ))}
      </div>
    );
  }
  if (!data) {
    return <table className="styled-table min-w-full text-sm"><tbody><tr><td colSpan={cols.length} className="text-center p-4 text-red-600">Veri yüklenemedi</td></tr></tbody></table>;
  }
  if (data.length === 0) {
    return <table className="styled-table min-w-full text-sm"><tbody><tr><td colSpan={cols.length} className="text-center p-4 text-gray-500">Veri yok.</td></tr></tbody></table>;
  }

  const arr = Array.isArray(data) ? data : [];
  const sorted = [...arr].sort((a, b) => {
    const type = getSortType(sortKey);
    let aVal = a[sortKey];
    let bVal = b[sortKey];
    if (type === "number") {
      aVal = Number(aVal);
      bVal = Number(bVal);
      if (isNaN(aVal)) aVal = -Infinity;
      if (isNaN(bVal)) bVal = -Infinity;
    } else {
      aVal = String(aVal || "");
      bVal = String(bVal || "");
    }
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  function handleSort(colKey: string) {
    if (sortKey === colKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colKey);
      setSortDir(colKey === "name" ? "asc" : "desc"); // Default: name asc, numbers desc
    }
  }

  return (
    <table className={tableClassName || "styled-table min-w-full text-sm"}>
      <thead>
        <tr>
          {cols.map((col) => (
            <th
              key={col.key}
              className={
                [
                  "sortable-header text-center px-2 py-2 whitespace-nowrap",
                  sortKey === col.key ? "sort-active sort-" + sortDir : "",
                ].join(" ")
              }
              onClick={() => handleSort(col.key)}
              style={{ cursor: "pointer" }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={row.steam_id || i}>
            {cols.map((col, j) => {
              let badgeStyle = {};
              if (col.heatmap && col.isBadge && heatmapStats[col.key]) {
                const v = Number(row[col.key]);
                if (!isNaN(v)) {
                  badgeStyle = {
                    backgroundColor: getHeatmapColor(v, heatmapStats[col.key].min, heatmapStats[col.key].max),
                    color: "#222",
                  };
                }
              }
              return (
                <td key={col.key} className={
                  [
                    j === 0 ? `font-medium whitespace-nowrap ${isDark ? 'text-gray-200' : 'text-gray-900'}` : "text-center",
                    col.isBadge ? "stat-badge-cell" : "",
                  ].join(" ")
                }>
                  {col.key === "name" && row.steam_id ? (
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:block flex-shrink-0">
                        <SteamAvatar 
                          steamId={String(row.steam_id)} 
                          playerName={String(row.name)} 
                          size="small" 
                          showLink={false}
                        />
                      </div>
                      <span>{formatValue(row[col.key], col)}</span>
                    </div>
                  ) : col.isBadge ? (
                    <span className="stat-badge" style={badgeStyle}>{formatValue(row[col.key], col)}</span>
                  ) : (
                    formatValue(row[col.key], col)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
} 
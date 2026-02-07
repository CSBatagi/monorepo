"use client";
import React, { useState, useMemo } from "react";
import SeasonStatsTable from "./SeasonStatsTable";
import { buildSeasonWindowOptions, filterDatesBySeason } from "@/lib/seasonRanges";
import { useTheme } from "@/contexts/ThemeContext";

type RoundInfo = {
  round_number?: number;
  end_reason?: number;
  winner_name?: string;
  winner_side?: number;
  team_a_name?: string;
  team_b_name?: string;
  team_a_side?: number;
  team_b_side?: number;
  team_a_score?: number;
  team_b_score?: number;
  overtime_number?: number;
};

type RoundSummary = {
  match_checksum?: string;
  max_rounds?: number;
  rounds?: RoundInfo[];
};

function normalizeTeamName(name: unknown): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^team[_\s]+/, "")
    .replace(/\s+/g, " ");
}

function getRoundReason(endReason?: number): "bomb" | "defuse" | "time" | "elimination" | "unknown" {
  switch (endReason) {
    case 1:
      return "bomb";
    case 7:
      return "defuse";
    case 12:
      return "time";
    case 8:
    case 9:
      return "elimination";
    default:
      return "unknown";
  }
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.5 7.5a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414l2.293 2.293 6.793-6.793a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function BombIcon({ className }: { className?: string }) {
  return (
    <span className={className} role="img" aria-label="Bomb explosion">
      💥
    </span>
  );
}

function DefuseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="#000000" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 380.152 380.152" xmlSpace="preserve">
      <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
      <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
      <g id="SVGRepo_iconCarrier">
        <g>
          <path d="M12.495,215.983c1.028,0.945,2.336,1.412,3.638,1.412c1.396,0,2.792-0.54,3.843-1.61 c79.89-81.634,213.551-86.151,214.889-86.188c1.927-0.051,3.686-1.129,4.594-2.827c0.914-1.695,0.841-3.753-0.174-5.386 c-11.479-18.439-4.714-32.656-4.44-33.216c1.261-2.457,0.457-5.468-1.862-6.966c-2.321-1.501-5.396-1-7.118,1.155 c-12.374,15.464-34.201,19.727-106.843,33.904C44.122,130.875,2.542,196.54,0.81,199.333c-1.365,2.194-0.971,5.049,0.934,6.797 L12.495,215.983z"></path>
          <g>
            <path d="M325.375,20.385c0.981-1.05,1.496-2.452,1.443-3.887c-0.052-1.436-0.693-2.791-1.753-3.759l-9.858-8.961 c-1.843-1.672-4.604-1.869-6.655-0.452c-2.064,1.415-49.151,34.108-52.525,71.358c-10.427,5.816-16.999,16.837-16.999,28.943 c0,7.981,2.804,15.546,7.959,21.557c-1.434,21.184-14.604,186.013-80.043,232.065c-1.192,0.836-1.989,2.122-2.215,3.561 c-0.231,1.434,0.137,2.897,1.013,4.062l8.063,10.751c0.908,1.208,2.284,1.984,3.795,2.127c0.163,0.016,0.336,0.021,0.504,0.021 c1.333,0,2.619-0.493,3.618-1.401c3.118-2.834,76.367-70.273,84.81-142.216c7.957-67.95,14.64-92.855,28.562-106.611 c0.083-0.079,0.179-0.181,0.272-0.288c0.631-0.636,1.208-1.313,1.774-2.001c0.005-0.005,0.604-0.725,0.609-0.729 c4.955-6.058,7.575-13.289,7.575-20.895c0-6.483-1.922-12.73-5.57-18.208C300.446,77.407,304.614,42.632,325.375,20.385z M269.48,117.959c-7.907,0-14.332-6.429-14.332-14.336c0-7.909,6.425-14.336,14.332-14.336c7.905,0,14.341,6.427,14.341,14.336 C283.821,111.53,277.38,117.959,269.48,117.959z"></path>
            <circle cx="269.48" cy="103.623" r="3.585"></circle>
            <path d="M379.296,68.457l-8.063-12.515c-0.992-1.535-2.703-2.451-4.529-2.451c-0.005,0-0.011,0-0.021,0 c-1.833,0.005-3.55,0.968-4.531,2.518c-0.551,0.866-13.821,21.221-51.68,26.155c-1.775,0.231-3.308,1.338-4.115,2.932 c-0.793,1.596-0.746,3.493,0.125,5.045c0.373,0.661,8.972,16.31,0.132,30.312c-1.286,2.045-1.06,4.693,0.556,6.478 c1.045,1.154,2.504,1.769,3.984,1.769c0.814,0,1.638-0.184,2.404-0.564l28.673-14.331c0.571-0.292,1.093-0.677,1.526-1.15 l34.941-37.627C380.389,73.226,380.625,70.52,379.296,68.457z"></path>
          </g>
        </g>
      </g>
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SwitchSidesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M7 7h11l-3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 17H6l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const sonmacColumns = [
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
  { key: "score", label: "Score", decimals: 0 },
  { key: "clutches", label: "Nr of clutches", decimals: 0 },
  { key: "clutches_won", label: "Clutches Won", decimals: 0 },
];

export default function SonMacClient({
  allData: initialData,
  dates: initialDates,
  seasonStarts,
}: {
  allData: Record<string, any>;
  dates: string[];
  seasonStarts: string[];
}) {
  const [data] = useState<Record<string, any>>(initialData);
  const [dates] = useState<string[]>(initialDates);
  const seasonOptions = useMemo(() => buildSeasonWindowOptions(seasonStarts || [], dates), [seasonStarts, dates]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasonOptions[0]?.id || "all_time");
  const selectedSeason = useMemo(
    () => seasonOptions.find((s) => s.id === selectedSeasonId) || seasonOptions[0] || { id: "all_time", label: "Tum Zamanlar", startDate: null, endDate: null },
    [seasonOptions, selectedSeasonId]
  );
  const filteredDates = useMemo(() => filterDatesBySeason(dates, selectedSeason), [dates, selectedSeason]);
  const [selectedDate, setSelectedDate] = useState(filteredDates[0] || "");
  const maps = data[selectedDate]?.maps || {};
  const mapNames = Object.keys(maps);
  const [selectedMap, setSelectedMap] = useState(mapNames[0] || "");

  // Client no longer triggers refresh; server layout ensures up-to-date data per request.

  React.useEffect(() => {
    if (!seasonOptions.some((s) => s.id === selectedSeasonId)) {
      setSelectedSeasonId(seasonOptions[0]?.id || "all_time");
    }
  }, [seasonOptions, selectedSeasonId]);

  React.useEffect(() => {
    if (!filteredDates.includes(selectedDate)) {
      setSelectedDate(filteredDates[0] || "");
    }
  }, [filteredDates, selectedDate]);

  // Update selectedMap if date changes
  React.useEffect(() => {
    const newMapNames = Object.keys(data[selectedDate]?.maps || {});
    setSelectedMap(newMapNames[0] || "");
  }, [selectedDate, data]);

  const mapData = maps[selectedMap] || {};
  const team1 = mapData.team1;
  const team2 = mapData.team2;
  const roundsInfo: RoundSummary | null = mapData.rounds || null;
  const rounds = Array.isArray(roundsInfo?.rounds) ? [...roundsInfo!.rounds!] : [];
  rounds.sort((a, b) => (a.round_number || 0) - (b.round_number || 0));
  const maxRounds = typeof roundsInfo?.max_rounds === "number" ? roundsInfo!.max_rounds! : null;
  const team1Norm = normalizeTeamName(team1?.name);
  const team2Norm = normalizeTeamName(team2?.name);

  function resolveWinnerSlot(r: RoundInfo): "team1" | "team2" | null {
    const winner = normalizeTeamName(r.winner_name);
    if (winner && winner === team1Norm) return "team1";
    if (winner && winner === team2Norm) return "team2";
    const teamA = normalizeTeamName(r.team_a_name);
    const teamB = normalizeTeamName(r.team_b_name);
    if (winner && winner === teamA) {
      if (teamA === team1Norm) return "team1";
      if (teamA === team2Norm) return "team2";
    }
    if (winner && winner === teamB) {
      if (teamB === team1Norm) return "team1";
      if (teamB === team2Norm) return "team2";
    }
    const inferredWinnerSide =
      typeof r.winner_side === "number"
        ? r.winner_side
        : r.end_reason === 8
          ? 3
          : r.end_reason === 9
            ? 2
            : null;
    if (inferredWinnerSide) {
      const team1Side = getTeamSideForSlot(r, "team1");
      const team2Side = getTeamSideForSlot(r, "team2");
      if (team1Side === inferredWinnerSide) return "team1";
      if (team2Side === inferredWinnerSide) return "team2";
    }
    return null;
  }

  function getTeamSideForSlot(r: RoundInfo, slot: "team1" | "team2"): number | null {
    const targetNorm = slot === "team1" ? team1Norm : team2Norm;
    const teamA = normalizeTeamName(r.team_a_name);
    const teamB = normalizeTeamName(r.team_b_name);
    if (targetNorm && teamA && targetNorm === teamA) {
      return typeof r.team_a_side === "number" ? r.team_a_side : null;
    }
    if (targetNorm && teamB && targetNorm === teamB) {
      return typeof r.team_b_side === "number" ? r.team_b_side : null;
    }
    return null;
  }

  function switchAfterRoundNumbers(): Set<number> {
    const set = new Set<number>();
    if (!rounds.length) return set;
    const byOvertime = new Map<number, RoundInfo[]>();
    for (const r of rounds) {
      const ot = typeof r.overtime_number === "number" ? r.overtime_number : 0;
      if (!byOvertime.has(ot)) byOvertime.set(ot, []);
      byOvertime.get(ot)!.push(r);
    }
    for (const [ot, list] of byOvertime.entries()) {
      const sorted = [...list].sort((a, b) => (a.round_number || 0) - (b.round_number || 0));
      if (!sorted.length) continue;
      let half = 0;
      if (ot === 0 && maxRounds && maxRounds > 0) {
        half = Math.floor(maxRounds / 2);
      } else {
        half = Math.floor(sorted.length / 2);
      }
      if (half <= 0 || sorted.length <= half) continue;
      const roundAtHalf = sorted[half - 1]?.round_number;
      if (typeof roundAtHalf === "number") set.add(roundAtHalf);
    }
    return set;
  }

  const switchAfter = switchAfterRoundNumbers();
  const { isDark } = useTheme();
  function sideLabel(side: number | null): { label: string; className: string } | null {
    if (side === 3) return { label: "CT", className: "text-gray-500" };
    if (side === 2) return { label: "T", className: "text-gray-500" };
    return null;
  }

  function roundIconFor(r: RoundInfo, teamSlot: "team1" | "team2") {
    const winnerSlot = resolveWinnerSlot(r);
    if (winnerSlot !== teamSlot) return null;
    const reason = getRoundReason(r.end_reason);
    const colorClass = teamSlot === "team1" ? "text-blue-500" : "text-green-500";
    const iconClass = `h-4 w-4 ${colorClass}`;
    switch (reason) {
      case "bomb":
        return <BombIcon className={`${colorClass} text-base`} />;
      case "defuse":
        return <DefuseIcon className={iconClass} />;
      case "time":
        return <ClockIcon className={iconClass} />;
      case "elimination":
        return <CheckIcon className={iconClass} />;
      default:
        return <CheckIcon className={iconClass} />;
    }
  }

  function roundCellContent(r: RoundInfo, slot: "team1" | "team2") {
    const icon = roundIconFor(r, slot);
    const side = getTeamSideForSlot(r, slot);
    const badge = sideLabel(side);
    return (
      <div className="flex flex-col items-center gap-0.5">
        {icon ? <span className="h-4 w-4 flex items-center justify-center">{icon}</span> : <span className="h-4 w-4" />}
        {badge ? <span className={`text-[10px] font-semibold ${badge.className}`}>{badge.label}</span> : <span className="h-3" />}
      </div>
    );
  }

  return (
    <>
      {/* Date Selector */}
      <div className={`mb-4 p-4 border rounded-lg shadow-sm ${isDark ? 'bg-dark-surface border-dark-border' : 'bg-gray-50'}`}>
        <label htmlFor="sonmac-season-selector" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Donem Secin:</label>
        <select
          id="sonmac-season-selector"
          className={`form-select block w-full mt-1 mb-4 rounded-md shadow-sm focus:ring focus:ring-opacity-50 ${isDark ? 'bg-dark-card border-dark-border text-gray-100 focus:border-blue-500 focus:ring-blue-500/20' : 'border-gray-300 focus:border-indigo-300 focus:ring-indigo-200'}`}
          value={selectedSeasonId}
          onChange={e => setSelectedSeasonId(e.target.value)}
        >
          {seasonOptions.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
        <label htmlFor="sonmac-date-selector" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Tarih Secin:</label>
        <select
          id="sonmac-date-selector"
          className={`form-select block w-full mt-1 rounded-md shadow-sm focus:ring focus:ring-opacity-50 ${isDark ? 'bg-dark-card border-dark-border text-gray-100 focus:border-blue-500 focus:ring-blue-500/20' : 'border-gray-300 focus:border-indigo-300 focus:ring-indigo-200'}`}
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
        >
          {filteredDates.length === 0 ? (
            <option>Veri yok</option>
          ) : (
            filteredDates.map(date => (
              <option key={date} value={date}>{date}</option>
            ))
          )}
        </select>
      </div>

      {/* Map Tabs */}
      <div className={`mb-4 border-b ${isDark ? 'border-dark-border' : 'border-gray-200'}`}>
        <ul className="flex flex-wrap -mb-px text-sm font-medium text-center">
          {mapNames.length === 0 ? (
            <li className={`p-4 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Map yok</li>
          ) : (
            mapNames.map(map => (
              <li key={map} className="mr-2" role="presentation">
                <button
                  className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${selectedMap === map ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`}
                  type="button"
                  role="tab"
                  aria-selected={selectedMap === map}
                  onClick={() => setSelectedMap(map)}
                >
                  {map}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Scoreboard and Team Tables */}
      {team1 && team2 ? (
        <div className="mb-8">
          {/* Scoreboard */}
          <div className={`flex justify-between md:justify-center md:gap-16 items-center mb-6 px-4 py-3 rounded-lg overflow-x-auto ${isDark ? 'bg-dark-card border border-dark-border' : 'bg-gray-100'}`}>
            <div className="text-center whitespace-nowrap">
              <h3 className={`text-lg font-bold ${isDark ? 'text-gray-100' : ''}`}>{team1.name}</h3>
              <div className="text-3xl font-extrabold text-blue-600">{team1.score}</div>
            </div>
            <div className={`text-xl md:text-3xl font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>vs</div>
            <div className="text-center whitespace-nowrap">
              <h3 className={`text-lg font-bold ${isDark ? 'text-gray-100' : ''}`}>{team2.name}</h3>
              <div className="text-3xl font-extrabold text-green-600">{team2.score}</div>
            </div>
          </div>
          {/* Team 1 Table */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-blue-600 mb-2 px-3">{team1.name}</h3>
            <div className="overflow-x-auto">
              <SeasonStatsTable data={team1.players} columns={sonmacColumns} tableClassName="styled-table min-w-[1200px] w-full text-sm" />
            </div>
          </div>
          {/* Round Summary */}
          <div className="mb-6">
            <div className="overflow-x-auto">
              <table className="sonmac-rounds-table min-w-max w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="sonmac-rounds-sticky sticky left-0 z-10 px-2 py-1 text-left font-semibold border border-gray-200">Round</th>
                    {rounds.map((r) => (
                      <th key={`head-${r.round_number}`} className="px-2 py-1 text-center font-medium text-gray-700 border border-gray-200">
                        {r.round_number}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="sonmac-rounds-sticky sticky left-0 z-10 px-2 py-1 font-medium text-blue-600 whitespace-nowrap border border-gray-200">{team1.name}</td>
                    {rounds.map((r) => (
                      <td key={`t1-${r.round_number}`} className="px-2 py-1 text-center border border-gray-200">
                        {roundCellContent(r, "team1")}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="sonmac-rounds-sticky sticky left-0 z-10 px-2 py-1 font-medium text-green-600 whitespace-nowrap border border-gray-200">{team2.name}</td>
                    {rounds.map((r) => (
                      <td key={`t2-${r.round_number}`} className="px-2 py-1 text-center border border-gray-200">
                        {roundCellContent(r, "team2")}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          {/* Team 2 Table */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-green-600 mb-2 px-3">{team2.name}</h3>
            <div className="overflow-x-auto">
              <SeasonStatsTable data={team2.players} columns={sonmacColumns} tableClassName="styled-table min-w-[1200px] w-full text-sm" />
            </div>
          </div>
        </div>
      ) : (
        <div className={`text-gray-500 p-4 ${isDark ? 'text-gray-400' : ''}`}>Veri yok.</div>
      )}
    </>
  );
} 

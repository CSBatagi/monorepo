"use client";
import React, { useState, useEffect } from "react";
import SeasonStatsTable from "./SeasonStatsTable";

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

export default function SonMacClient({ allData: initialData, dates: initialDates }: { allData: Record<string, any>; dates: string[] }) {
  const [data, setData] = useState<Record<string, any>>(initialData);
  const [dates, setDates] = useState<string[]>(initialDates);
  const [selectedDate, setSelectedDate] = useState(initialDates[0] || "");
  const maps = data[selectedDate]?.maps || {};
  const mapNames = Object.keys(maps);
  const [selectedMap, setSelectedMap] = useState(mapNames[0] || "");

  // Client no longer triggers refresh; server layout ensures up-to-date data per request.

  // Update selectedMap if date changes
  React.useEffect(() => {
    const newMapNames = Object.keys(data[selectedDate]?.maps || {});
    setSelectedMap(newMapNames[0] || "");
  }, [selectedDate, data]);

  const mapData = maps[selectedMap] || {};
  const team1 = mapData.team1;
  const team2 = mapData.team2;

  return (
    <>
      {/* Date Selector */}
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <label htmlFor="sonmac-date-selector" className="block text-sm font-medium text-gray-700 mb-1">Tarih Seçin:</label>
        <select
          id="sonmac-date-selector"
          className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
        >
          {dates.length === 0 ? (
            <option>Veri yok</option>
          ) : (
            dates.map(date => (
              <option key={date} value={date}>{date}</option>
            ))
          )}
        </select>
      </div>

      {/* Map Tabs */}
      <div className="mb-4 border-b border-gray-200">
        <ul className="flex flex-wrap -mb-px text-sm font-medium text-center">
          {mapNames.length === 0 ? (
            <li className="text-gray-500 p-4">Map yok</li>
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
          <div className="flex justify-between md:justify-center md:gap-16 items-center mb-6 px-4 py-3 bg-gray-100 rounded-lg overflow-x-auto">
            <div className="text-center whitespace-nowrap">
              <h3 className="text-lg font-bold">{team1.name}</h3>
              <div className="text-3xl font-extrabold text-blue-600">{team1.score}</div>
            </div>
            <div className="text-xl md:text-3xl font-semibold text-gray-500">vs</div>
            <div className="text-center whitespace-nowrap">
              <h3 className="text-lg font-bold">{team2.name}</h3>
              <div className="text-3xl font-extrabold text-green-600">{team2.score}</div>
            </div>
          </div>
          {/* Team 1 Table */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-blue-600 mb-2 px-3">{team1.name}</h3>
            <div className="overflow-x-auto">
              <SeasonStatsTable data={team1.players} columns={sonmacColumns} tableClassName="min-w-[1200px] w-full" />
            </div>
          </div>
          {/* Team 2 Table */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-green-600 mb-2 px-3">{team2.name}</h3>
            <div className="overflow-x-auto">
              <SeasonStatsTable data={team2.players} columns={sonmacColumns} tableClassName="min-w-[1200px] w-full" />
            </div>
          </div>
        </div>
      ) : (
        <div className="text-gray-500 p-4">Veri yok.</div>
      )}
    </>
  );
} 
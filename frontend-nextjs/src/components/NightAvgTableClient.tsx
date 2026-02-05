"use client";

import { useEffect, useMemo, useState } from "react";
import React from "react";
import SeasonStatsTable from "./SeasonStatsTable";
import H2HClient from "./H2HClient";
import { RadarGraphs } from "./SeasonAvgRadarGraphs";
import { buildSeasonWindowOptions, filterDatesBySeason } from "@/lib/seasonRanges";

const nightAvgColumns = [
  { key: "name", label: "Oyuncu" },
  { key: "HLTV 2", label: "HLTV2", decimals: 2, isBadge: true, heatmap: true },
  { key: "ADR", label: "ADR", decimals: 1, isBadge: true, heatmap: true },
  { key: "K/D", label: "K/D", decimals: 2, isBadge: true, heatmap: true },
  { key: "HLTV2 DIFF", label: "HLTV2 DIFF", decimals: 2, heatmap: true, isBadge: true },
  { key: "ADR DIFF", label: "ADR DIFF", decimals: 1, heatmap: true, isBadge: true },
  { key: "MVP", label: "MVP", decimals: 2 },
  { key: "Kills", label: "Kills", decimals: 1 },
  { key: "Deaths", label: "Deaths", decimals: 1 },
  { key: "Assists", label: "Assists", decimals: 1 },
  { key: "HS", label: "HS", decimals: 1 },
  { key: "HS/Kill ratio", label: "HS/Kill ratio", decimals: 1, isPercentage: true },
  { key: "First Kill", label: "First Kill", decimals: 1 },
  { key: "First Death", label: "First Death", decimals: 1 },
  { key: "Bomb Planted", label: "Bomb Planted", decimals: 1 },
  { key: "Bomb Defused", label: "Bomb Defused", decimals: 1 },
  { key: "HLTV", label: "HLTV", decimals: 2 },
  { key: "KAST", label: "KAST", decimals: 1, isPercentage: true },
  { key: "Utility Damage", label: "Utility Damage", decimals: 1 },
  { key: "2 kills", label: "2 kills", decimals: 1 },
  { key: "3 kills", label: "3 kills", decimals: 1 },
  { key: "4 kills", label: "4 kills", decimals: 1 },
  { key: "5 kills", label: "5 kills", decimals: 1 },
  { key: "Nr of Matches", label: "Nr of Matches", decimals: 0 },
  { key: "Clutch Opportunity", label: "Clutch Opportunity", decimals: 0 },
  { key: "Clutches Won", label: "Clutches Won", decimals: 0 },
];

export default function NightAvgTableClient({
  allData: initialData,
  dates: initialDates,
  seasonStarts,
}: {
  allData: Record<string, any[]>;
  dates: string[];
  seasonStarts: string[];
}) {
  const [dataMap, setDataMap] = useState<Record<string, any[]>>(initialData);
  const [dates, setDates] = useState<string[]>(initialDates);
  const [loading, setLoading] = useState<boolean>(Object.keys(initialData || {}).length === 0);
  const [activeTab, setActiveTab] = useState<"table" | "graph" | "head2head">("table");

  const seasonOptions = useMemo(() => buildSeasonWindowOptions(seasonStarts || [], dates), [seasonStarts, dates]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(seasonOptions[0]?.id || "all_time");
  const selectedSeason = useMemo(
    () => seasonOptions.find((s) => s.id === selectedSeasonId) || seasonOptions[0] || { id: "all_time", label: "Tum Zamanlar", startDate: null, endDate: null },
    [seasonOptions, selectedSeasonId]
  );
  const filteredDates = useMemo(() => filterDatesBySeason(dates, selectedSeason), [dates, selectedSeason]);

  const [selectedDate, setSelectedDate] = useState<string>(filteredDates[0] || "");
  const data = dataMap[selectedDate] || [];

  useEffect(() => {
    const lastKnownTs = typeof window !== "undefined" ? localStorage.getItem("stats_last_ts") : null;
    const cacheBust = Date.now();
    fetch(
      `/api/stats/check${lastKnownTs ? `?lastKnownTs=${encodeURIComponent(lastKnownTs)}&` : "?"}_cb=${cacheBust}`,
      { cache: "no-store", headers: { "Cache-Control": "no-store" } }
    )
      .then((r) => r.json())
      .then((j) => {
        const incoming = j?.night_avg_all || j?.night_avg;
        if (j.updated && incoming) {
          setDataMap(incoming);
          const newDates = Object.keys(incoming).sort((a, b) => b.localeCompare(a));
          setDates(newDates);
          setSelectedDate((prev) => (newDates.includes(prev) ? prev : (newDates[0] || "")));
        }
        if (j.serverTimestamp) {
          localStorage.setItem("stats_last_ts", j.serverTimestamp);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    setActiveTab("table");
  }, [selectedDate]);

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

  return (
    <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
      <label htmlFor="night-avg-season-selector" className="block text-sm font-medium text-gray-700 mb-1">Donem Secin:</label>
      <select
        id="night-avg-season-selector"
        className="form-select block w-full mt-1 mb-4 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
        value={selectedSeasonId}
        onChange={(e) => setSelectedSeasonId(e.target.value)}
      >
        {seasonOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>

      <label htmlFor="night-avg-date-selector" className="block text-sm font-medium text-gray-700 mb-1">Tarih Secin:</label>
      <select
        id="night-avg-date-selector"
        className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
      >
        {filteredDates.length === 0 ? (
          <option>Veri yok</option>
        ) : (
          filteredDates.map((date) => (
            <option key={date} value={date}>{date}</option>
          ))
        )}
      </select>

      <div className="mt-6">
        <ul className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "table" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`} id="night-avg-table-tab" type="button" role="tab" aria-controls="night-avg-tab-table" aria-selected={activeTab === "table"} onClick={() => setActiveTab("table")}>Tablo</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "graph" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`} id="night-avg-graph-tab" type="button" role="tab" aria-controls="night-avg-tab-graph" aria-selected={activeTab === "graph"} onClick={() => setActiveTab("graph")}>Grafik</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "head2head" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`} id="night-avg-head2head-tab" type="button" role="tab" aria-controls="night-avg-tab-head2head" aria-selected={activeTab === "head2head"} onClick={() => setActiveTab("head2head")}>Karsilastirma</button>
          </li>
        </ul>
      </div>

      <div className="mt-6 relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 text-sm text-gray-600 z-10">
            <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2" />
            Yukleniyor...
          </div>
        )}
        {activeTab === "table" && (
          <div id="night-avg-tab-table" className="night-avg-tab-pane active" role="tabpanel" aria-labelledby="night-avg-table-tab">
            <div className="overflow-x-auto w-full">
              <SeasonStatsTable data={data} columns={nightAvgColumns} tableClassName="min-w-[1200px] w-full" loading={loading} />
            </div>
          </div>
        )}
        {activeTab === "graph" && (
          <div id="night-avg-tab-graph" className="night-avg-tab-pane active" role="tabpanel" aria-labelledby="night-avg-graph-tab">
            <RadarGraphs
              data={data}
              statConfig={nightAvgColumns.reduce((acc: Record<string, any>, col, i) => {
                acc[col.key] = { label: col.label, default: i < 5, format: col.isPercentage ? "percent" : undefined };
                return acc;
              }, {})}
              playerFilterKey="Nr of Matches"
              title="Pentagon Istatistiklerini Ozellestir (Gece Ortalamasi)"
            />
          </div>
        )}
        {activeTab === "head2head" && (
          <div id="night-avg-tab-head2head" className="night-avg-tab-pane active" role="tabpanel" aria-labelledby="night-avg-head2head-tab">
            <H2HClient data={data} columns={nightAvgColumns} matchesKey="Nr of Matches" />
          </div>
        )}
      </div>
    </div>
  );
}

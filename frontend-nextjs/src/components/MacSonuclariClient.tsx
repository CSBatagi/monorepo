"use client";

import React, { useMemo, useState, useEffect } from "react";
import MatchList from "./MatchList";
import MatchDetails from "./MatchDetails";
import { buildSeasonWindowOptions, filterDataBySeason } from "@/lib/seasonRanges";

interface Team {
  name: string;
  score: number;
  players: any[];
}

interface MapData {
  team1: Team;
  team2: Team;
}

interface MacSonuclariClientProps {
  allData: Record<string, any>;
  dates: string[];
  seasonStarts: string[];
}

export default function MacSonuclariClient({ allData, seasonStarts }: MacSonuclariClientProps) {
  const allDates = useMemo(
    () => Object.keys(allData || {}).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()),
    [allData]
  );

  const seasonOptions = useMemo(() => buildSeasonWindowOptions(seasonStarts || [], allDates), [seasonStarts, allDates]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(seasonOptions[0]?.id || "all_time");
  const selectedSeason = useMemo(
    () => seasonOptions.find((s) => s.id === selectedSeasonId) || seasonOptions[0] || { id: "all_time", label: "Tum Zamanlar", startDate: null, endDate: null },
    [seasonOptions, selectedSeasonId]
  );

  const scopedData = useMemo(() => filterDataBySeason(allData, selectedSeason), [allData, selectedSeason]);
  const scopedDates = useMemo(
    () => Object.keys(scopedData || {}).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()),
    [scopedData]
  );

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!seasonOptions.some((s) => s.id === selectedSeasonId)) {
      setSelectedSeasonId(seasonOptions[0]?.id || "all_time");
    }
  }, [seasonOptions, selectedSeasonId]);

  useEffect(() => {
    if (selectedDate && !scopedDates.includes(selectedDate)) {
      setSelectedDate(null);
    }
  }, [selectedDate, scopedDates]);

  const handleDateSelect = (date: string) => setSelectedDate(date);
  const handleBack = () => setSelectedDate(null);

  if (selectedDate) {
    const nightData = scopedData[selectedDate];
    if (!nightData || !nightData.maps) {
      return (
        <div>
          <p>Match data not found for this date.</p>
          <button onClick={handleBack} className="text-blue-500">Back</button>
        </div>
      );
    }
    return (
      <>
        <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
          <label htmlFor="mac-sonuclari-season-selector" className="block text-sm font-medium text-gray-700 mb-1">Donem Secin:</label>
          <select
            id="mac-sonuclari-season-selector"
            className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
          >
            {seasonOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
        <MatchDetails nightData={nightData} onBack={handleBack} />
      </>
    );
  }

  return (
    <>
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <label htmlFor="mac-sonuclari-season-selector" className="block text-sm font-medium text-gray-700 mb-1">Donem Secin:</label>
        <select
          id="mac-sonuclari-season-selector"
          className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
          value={selectedSeasonId}
          onChange={(e) => setSelectedSeasonId(e.target.value)}
        >
          {seasonOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>
      {scopedDates.length === 0 ? (
        <div className="p-4 text-gray-500">Veri yok.</div>
      ) : (
        <MatchList allData={scopedData} onDateSelect={handleDateSelect} />
      )}
    </>
  );
}

"use client";
import React, { useState } from "react";
import MatchList from './MatchList';
import MatchDetails from './MatchDetails';

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
}

export default function MacSonuclariClient({ allData, dates }: MacSonuclariClientProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
  };

  const handleBack = () => {
    setSelectedDate(null);
  };

  if (selectedDate) {
    const nightData = allData[selectedDate];
    if (!nightData || !nightData.maps) {
        return (
            <div>
                <p>Match data not found for this date.</p>
                <button onClick={handleBack} className="text-blue-500">Back</button>
            </div>
        );
    }

    return <MatchDetails nightData={nightData} onBack={handleBack} />;
  }

  return <MatchList allData={allData} onDateSelect={handleDateSelect} />;
}

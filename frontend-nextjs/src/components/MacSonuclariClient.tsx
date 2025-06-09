"use client";
import React, { useState } from "react";

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

function getTeamsAndScores(maps: Record<string, MapData>) {
  const teamNames = new Set<string>();
  let teamAWins = 0;
  let teamBWins = 0;
  let teamA = '';
  let teamB = '';
  
  // First, collect all team names from the maps
  Object.values(maps).forEach((map: any) => {
    if (map.team1?.name) teamNames.add(map.team1.name);
    if (map.team2?.name) teamNames.add(map.team2.name);
  });
  
  // Convert Set to Array for easy access
  const teamNamesArray = Array.from(teamNames);
  if (teamNamesArray.length >= 2) {
    teamA = teamNamesArray[0];
    teamB = teamNamesArray[1];
  }
  
  // Count wins for each map by comparing scores
  Object.values(maps).forEach((map: any) => {
    if (!map.team1 || !map.team2) return;
    
    // Get the actual scores from the team objects
    const team1Score = map.team1.score;
    const team2Score = map.team2.score;
    
    // Determine which team is which
    const team1IsTeamA = map.team1.name === teamA;
    const team2IsTeamA = map.team2.name === teamA;
    const team1IsTeamB = map.team1.name === teamB;
    const team2IsTeamB = map.team2.name === teamB;
    
    // Calculate who won the map
    if (team1Score > team2Score) {
      // Team 1 won this map
      if (team1IsTeamA) teamAWins++;
      if (team1IsTeamB) teamBWins++;
    } else if (team2Score > team1Score) {
      // Team 2 won this map
      if (team2IsTeamA) teamAWins++;
      if (team2IsTeamB) teamBWins++;
    }
    // If scores are equal (draw), do not increment wins
  });
  
  return {
    teamA,
    teamB,
    teamAWins,
    teamBWins
  };
}

export default function MacSonuclariClient({ allData, dates }: MacSonuclariClientProps) {
  const [selectedDate, setSelectedDate] = useState(dates[0] || "");
  const maps = allData[selectedDate]?.maps || {};
  const mapNames = Object.keys(maps);
  const { teamA, teamB, teamAWins, teamBWins } = getTeamsAndScores(maps);
  let teamAPlayers: any[] = [];
  let teamBPlayers: any[] = [];
  for (const map of Object.values(maps) as MapData[]) {
    if (map.team1?.name === teamA && teamAPlayers.length === 0) teamAPlayers = map.team1.players;
    if (map.team2?.name === teamA && teamAPlayers.length === 0) teamAPlayers = map.team2.players;
    if (map.team1?.name === teamB && teamBPlayers.length === 0) teamBPlayers = map.team1.players;
    if (map.team2?.name === teamB && teamBPlayers.length === 0) teamBPlayers = map.team2.players;
  }

  return (
    <>
      {/* Date Selector */}
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <label htmlFor="macsonuclari-date-selector" className="block text-sm font-medium text-gray-700 mb-1">Tarih Seçin:</label>
        <select
          id="macsonuclari-date-selector"
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

      {/* Teams and Overall Score */}
      {teamA && teamB ? (
        <div className="mb-6">
          <div className="flex justify-between md:justify-center md:gap-16 items-center mb-6 px-4 py-3 bg-gray-100 rounded-lg overflow-x-auto">
            <div className="text-center whitespace-nowrap">
              <h3 className="text-lg font-bold">{teamA}</h3>
            </div>
            <div className="text-xl md:text-3xl font-semibold text-blue-600">{teamAWins} - {teamBWins}</div>
            <div className="text-center whitespace-nowrap">
              <h3 className="text-lg font-bold">{teamB}</h3>
            </div>
          </div>          {/* Per Map Scores */}
          <div className="mb-6">
            <h4 className="text-md font-semibold mb-2 text-blue-700">Harita Skorları</h4>
            <div className="flex flex-col gap-2">
              {mapNames.map(mapName => {
                const map = maps[mapName];
                
                // Determine scores for consistent team order display
                const teamAIsTeam1 = map.team1.name === teamA;
                
                // Show team scores in consistent order (teamA - teamB)
                const leftTeamName = teamAIsTeam1 ? map.team1.name : map.team2.name;
                const rightTeamName = teamAIsTeam1 ? map.team2.name : map.team1.name;
                const leftScore = teamAIsTeam1 ? map.team1.score : map.team2.score;
                const rightScore = teamAIsTeam1 ? map.team2.score : map.team1.score;
                
                return (
                  <div key={mapName} className="flex flex-wrap items-center gap-2 bg-gray-50 rounded p-2 border overflow-hidden">
                    <span className="font-medium w-28 md:w-32 text-sm md:text-base">{mapName}</span>
                    <div className="flex flex-grow items-center justify-between md:justify-start md:gap-4">
                      <div className="flex items-center">
                        <span className="font-bold text-blue-700 text-sm md:text-base truncate max-w-24 md:max-w-36">{leftTeamName}</span>
                        <span className="text-lg font-bold text-blue-600 ml-2">{leftScore}</span>
                      </div>
                      <span className="text-gray-500 mx-2">-</span>
                      <div className="flex items-center">
                        <span className="text-lg font-bold text-green-600 mr-2">{rightScore}</span>
                        <span className="font-bold text-green-700 text-sm md:text-base truncate max-w-24 md:max-w-36">{rightTeamName}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team Players */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-md font-semibold mb-2 text-blue-700">{teamA} Oyuncuları</h4>
              <ul className="list-disc ml-6">
                {teamAPlayers.map((p: any) => (
                  <li key={p.name}>{p.name}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-md font-semibold mb-2 text-green-700">{teamB} Oyuncuları</h4>
              <ul className="list-disc ml-6">
                {teamBPlayers.map((p: any) => (
                  <li key={p.name}>{p.name}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-gray-500 p-4">Veri yok.</div>
      )}
    </>
  );
}

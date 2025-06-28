"use client";
import React from 'react';

// Define interfaces for our data structures
interface Team {
  name: string;
  score: number;
}

interface MapData {
  team1: Team;
  team2: Team;
}

interface MatchData {
  maps: Record<string, MapData>;
}

// Helper function to determine the main league teams for a given night
function getMainLeagueTeams(maps: Record<string, MapData>): [string | undefined, string | undefined] {
  const teamNames = new Set<string>();
  Object.values(maps).forEach((map: any) => {
    if (map.team1?.name) teamNames.add(map.team1.name);
    if (map.team2?.name) teamNames.add(map.team2.name);
  });

  const GENERIC_NAMES = ["Team A", "Team B"];
  const leagueTeamNames = Array.from(teamNames).filter(
    name => !GENERIC_NAMES.includes(name)
  );

  if (leagueTeamNames.length >= 2) {
    return [leagueTeamNames[0], leagueTeamNames[1]];
  } else {
    const allTeamNames = Array.from(teamNames);
    return [allTeamNames[0], allTeamNames[1]];
  }
}

interface MatchListProps {
  allData: Record<string, MatchData>;
  onDateSelect: (date: string) => void;
}

export default function MatchList({ allData, onDateSelect }: MatchListProps) {
  const dates = Object.keys(allData).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  };

  const Dot = ({ isWinner }: { isWinner: boolean | null }) => {
    const bgColor = isWinner === true ? 'bg-green-500' : isWinner === false ? 'bg-red-500' : 'bg-gray-400';
    return <span className={`w-3 h-3 ${bgColor} rounded-full mr-3`}></span>;
  }

  return (
    <div className="bg-white rounded-lg shadow">
        <div className="space-y-1">
        {dates.map(date => {
            const maps = allData[date].maps || {};
            const mapNames = Object.keys(maps);
            if (mapNames.length === 0) return null;

            const [teamA, teamB] = getMainLeagueTeams(maps);
            let teamAWins = 0;
            let teamBWins = 0;

            if (teamA && teamB) {
                for (const map of Object.values(maps) as MapData[]) {
                    if (!map.team1 || !map.team2) continue;
                    
                    const team1Won = map.team1.score > map.team2.score;
    
                    if (map.team1.name === teamA) {
                        if (team1Won) teamAWins++; else teamBWins++;
                    } else if (map.team1.name === teamB) {
                        if (team1Won) teamBWins++; else teamAWins++;
                    }
                }
            }
            
            const teamAWonNight = teamA && teamB ? teamAWins > teamBWins : null;
            const teamBWonNight = teamA && teamB ? teamBWins > teamAWins : null;

            return (
            <div
                key={date}
                className="flex items-center p-3 border-b border-gray-200 cursor-pointer hover:bg-gray-200 last:border-b-0 transition-colors"
                onClick={() => onDateSelect(date)}
            >
                <div className="flex-shrink-0 mr-4 w-16 text-center">
                    <span className="text-sm text-gray-600">{formatDate(date)}</span>
                </div>
                <div className="flex-grow min-w-0">
                    {teamA && (
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center min-w-0">
                                <Dot isWinner={teamAWonNight} />
                                <span className="text-gray-800 truncate">{teamA}</span>
                            </div>
                            <span className="font-bold text-gray-800 ml-4">{teamAWins}</span>
                        </div>
                    )}
                    {teamB && (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                                <Dot isWinner={teamBWonNight} />
                                <span className="text-gray-800 truncate">{teamB}</span>
                            </div>
                            <span className="font-bold text-gray-800 ml-4">{teamBWins}</span>
                        </div>
                    )}
                </div>
            </div>
            );
        })}
        </div>
    </div>
  );
} 
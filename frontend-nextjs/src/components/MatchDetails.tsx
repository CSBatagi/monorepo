"use client";
import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

// Define interfaces for our data structures
interface Player {
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  hltv_2: number;
}

interface Team {
  name: string;
  score: number;
  players: Player[];
}

interface MapData {
    team1: Team;
    team2: Team;
}

interface MatchDetailsProps {
  nightData: {
    maps: Record<string, MapData>;
  };
  onBack: () => void;
}

export default function MatchDetails({ nightData, onBack }: MatchDetailsProps) {
  const { maps } = nightData;
  const mapNames = Object.keys(maps);
  const { isDark } = useTheme();

  const renderPlayerStats = (players: Player[]) => {
    // Sort players by HLTV rating descending
    const sortedPlayers = [...players].sort((a, b) => b.hltv_2 - a.hltv_2);

    return (
      <div className="overflow-x-auto">
        <table className={`min-w-full divide-y ${isDark ? 'divide-dark-border' : 'divide-gray-200'}`}>
          <thead className={isDark ? 'bg-dark-surface' : 'bg-gray-50'}>
            <tr>
              <th className={`px-2 sm:px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Player</th>
              <th className={`px-2 sm:px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>K</th>
              <th className={`px-2 sm:px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>D</th>
              <th className={`px-2 sm:px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>A</th>
              <th className={`px-2 sm:px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>ADR</th>
              <th className={`px-2 sm:px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>HLTV</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isDark ? 'bg-dark-card divide-dark-border' : 'bg-white divide-gray-200'}`}>
            {sortedPlayers.map(player => (
              <tr key={player.name}>
                <td className={`px-2 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>{player.name}</td>
                <td className={`px-2 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{player.kills}</td>
                <td className={`px-2 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{player.deaths}</td>
                <td className={`px-2 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{player.assists}</td>
                <td className={`px-2 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{player.adr.toFixed(1)}</td>
                <td className={`px-2 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{player.hltv_2.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className={`p-4 rounded-lg shadow ${isDark ? 'bg-dark-card text-gray-200' : 'bg-white text-gray-800'}`}>
      <button onClick={onBack} className={`mb-4 ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'}`}>
        &larr; Back to all matches
      </button>

      {mapNames.map(mapName => {
        const match = maps[mapName];
        if (!match || !match.team1 || !match.team2) return null;
        
        const { team1, team2 } = match;

        return (
            <div key={mapName} className={`mb-8 p-4 border rounded-lg ${isDark ? 'border-dark-border' : ''}`}>
                <div className={`flex flex-col md:flex-row justify-between items-center mb-4 p-4 rounded-lg text-center ${isDark ? 'bg-dark-surface' : 'bg-gray-50'}`}>
                    <div className={`text-lg md:text-xl font-bold truncate w-full md:w-auto md:text-left ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{team1.name}</div>
                    <div className="text-2xl md:text-3xl font-bold text-blue-600 my-2 md:my-0 md:mx-4">
                        {team1.score} - {team2.score}
                    </div>
                    <div className={`text-lg md:text-xl font-bold truncate w-full md:w-auto md:text-right ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{team2.name}</div>
                </div>
                <div className={`text-center text-lg mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{mapName}</div>

                <div className="space-y-6">
                    <div>
                    <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{team1.name}</h3>
                    {renderPlayerStats(team1.players)}
                    </div>
                    <div>
                    <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{team2.name}</h3>
                    {renderPlayerStats(team2.players)}
                    </div>
                </div>
            </div>
        )
      })}
    </div>
  );
} 
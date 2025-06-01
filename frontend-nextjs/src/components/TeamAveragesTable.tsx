import React from 'react';

interface TeamAveragesTableProps {
  teamA: Record<string, number | null>;
  teamB: Record<string, number | null>;
  statLabels: Record<string, string>;
  statOrder: string[];
}

function formatStat(value: number | null | undefined, decimals: number = 2) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return decimals === 0 ? Math.round(value) : value.toFixed(decimals);
}

const TeamAveragesTable: React.FC<TeamAveragesTableProps> = ({ teamA, teamB, statLabels, statOrder }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-100 text-xs font-medium text-gray-600 uppercase">
            <th className="px-2 py-1 text-left">Stat</th>
            <th className="px-2 py-1 text-center">Team A</th>
            <th className="px-2 py-1 text-center">Team B</th>
            <th className="px-2 py-1 text-center">A - B</th>
          </tr>
        </thead>
        <tbody>
          {statOrder.map((key) => {
            const a = teamA[key];
            const b = teamB[key];
            const diff = (typeof a === 'number' && typeof b === 'number') ? a - b : null;
            let diffClass = 'text-gray-500';
            if (typeof diff === 'number' && !isNaN(diff)) {
              if (diff > 0.001) diffClass = 'text-green-600 font-semibold';
              else if (diff < -0.001) diffClass = 'text-red-600 font-semibold';
            }
            const decimals = key.includes('ADR') ? 0 : 2;
            return (
              <tr key={key}>
                <td className="px-2 py-1 font-medium text-gray-900">{statLabels[key] || key}</td>
                <td className="px-2 py-1 text-center">{formatStat(a, decimals)}</td>
                <td className="px-2 py-1 text-center">{formatStat(b, decimals)}</td>
                <td className={`px-2 py-1 text-center ${diffClass}`}>{formatStat(diff, decimals)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TeamAveragesTable; 
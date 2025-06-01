import React, { useMemo } from 'react';
import { Radar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface TeamComparisonRadarProps {
  teamA: Record<string, number | null>;
  teamB: Record<string, number | null>;
  statLabels: Record<string, string>;
  statOrder: string[];
  fixedRanges: Record<string, { min: number; max: number }>;
}

function normalizeStatWithFixedRange(value: number | null | undefined, statKey: string, fixedRanges: Record<string, { min: number; max: number }>) {
  const range = fixedRanges[statKey];
  if (!range || range.max === range.min || typeof value !== 'number' || isNaN(value)) {
    return 0;
  }
  const clampedValue = Math.max(range.min, Math.min(range.max, value));
  const normalized = ((clampedValue - range.min) / (range.max - range.min)) * 100;
  return Math.max(0, Math.min(100, normalized));
}

const TeamComparisonRadar: React.FC<TeamComparisonRadarProps> = ({ teamA, teamB, statLabels, statOrder, fixedRanges }) => {
  // Generate axis labels with ranges
  const axisLabels = useMemo(() =>
    statOrder.map((k) => {
      const label = statLabels[k] || k;
      const range = fixedRanges[k];
      if (range && typeof range.min === 'number' && typeof range.max === 'number') {
        const decimals = k.includes('ADR') ? 0 : 2;
        return `${label} (${range.min.toFixed(decimals)}-${range.max.toFixed(decimals)})`;
      }
      return label;
    }),
    [statOrder, statLabels, fixedRanges]
  );

  const data = useMemo(() => {
    return {
      labels: axisLabels,
      datasets: [
        {
          label: 'Team A',
          data: statOrder.map((k) => normalizeStatWithFixedRange(teamA[k], k, fixedRanges)),
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          borderColor: 'rgb(54, 162, 235)',
          pointBackgroundColor: 'rgb(54, 162, 235)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgb(54, 162, 235)',
          borderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Team B',
          data: statOrder.map((k) => normalizeStatWithFixedRange(teamB[k], k, fixedRanges)),
          backgroundColor: 'rgba(22, 163, 74, 0.2)',
          borderColor: 'rgb(22, 163, 74)',
          pointBackgroundColor: 'rgb(22, 163, 74)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgb(22, 163, 74)',
          borderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [teamA, teamB, statOrder, fixedRanges, axisLabels]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: '#1f2937',
          boxWidth: 16,
          padding: 10,
          font: { size: 12 },
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: function (context: any) {
            return `${context.dataset.label}: ${context.formattedValue}`;
          },
        },
      },
    },
    scales: {
      r: {
        angleLines: {
          display: true,
          lineWidth: 0.5,
          color: 'rgba(0,0,0,0.1)',
        },
        min: 0,
        max: 100,
        ticks: { display: false },
        pointLabels: {
          font: { size: 11, weight: 700 },
          color: '#1f2937',
        },
        grid: {
          color: 'rgba(0,0,0,0.08)',
          lineWidth: 0.5,
        },
      },
    },
    layout: { padding: 10 },
  }), []);

  return (
    <div className="w-full h-[320px]">
      <Radar data={data} options={options} />
    </div>
  );
};

export default TeamComparisonRadar; 
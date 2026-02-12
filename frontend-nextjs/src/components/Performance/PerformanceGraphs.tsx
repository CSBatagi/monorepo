"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { useTheme } from '@/contexts/ThemeContext';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface PerformanceEntry {
  match_date: string;
  hltv_2: number | null;
  adr: number | null;
}

interface PlayerPerformance {
  name: string;
  performance: PerformanceEntry[];
}

interface PerformanceGraphsProps { initialData?: PlayerPerformance[] }

const PerformanceGraphs: React.FC<PerformanceGraphsProps> = ({ initialData = [] }) => {
  const { isDark } = useTheme();
  const [performanceData, setPerformanceData] = useState<PlayerPerformance[]>(initialData);
    const [uniqueDates, setUniqueDates] = useState<string[]>([]);
    const [metric, setMetric] = useState<'hltv_2' | 'adr'>('hltv_2');
    const [visiblePlayers, setVisiblePlayers] = useState<string[]>([]);
    const [playerColors, setPlayerColors] = useState<{ [key: string]: string }>({});
    const [activeTab, setActiveTab] = useState<'graph' | 'table'>('graph');
  const [loading, setLoading] = useState<boolean>(initialData.length === 0);
    const [error, setError] = useState<string | null>(null);
  
    useEffect(() => {
      // If we already have initial data, we still attempt a background refresh but avoid blocking UI
      const fetchData = async () => {
        try {
          // Prefer runtime-data via stats proxy: if missing, trigger stats check and then try runtime path
          let response = await fetch('/api/stats/check?includeAll=1&_cb=' + Date.now(), { cache: 'no-store' });
          let data: PlayerPerformance[] | null = null;
          if (response.ok) {
            try {
              const payload = await response.json();
              if (Array.isArray(payload.performance_data)) {
                data = payload.performance_data;
              }
            } catch(_) {}
          }
          if (!data) {
            // API didn't return performance_data (e.g. updated:false with no payload).
            // Keep the server-rendered initialData rather than fetching the stale static file.
            if (initialData.length > 0) {
              data = initialData;
            } else {
              // True cold start with no initialData — last resort static fallback
              response = await fetch('/data/performance_data.json?_cb=' + Date.now());
              if (response.ok) {
                data = await response.json();
              }
            }
          }
          const perfArray: PlayerPerformance[] = data || [];
          perfArray.sort((a, b) => a.name.localeCompare(b.name));
  
          const dateSet = new Set<string>();
          perfArray.forEach(player => {
            player.performance.forEach(entry => {
              dateSet.add(entry.match_date);
            });
          });
          const sortedDates = Array.from(dateSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
          
          const colors: { [key: string]: string } = {};
          perfArray.forEach(player => {
            colors[player.name] = stringToColor(player.name + 'salt');
          });
          setPerformanceData(perfArray);
          setUniqueDates(sortedDates);
          setVisiblePlayers(perfArray.map(p => p.name)); // Initially all players are visible
          setPlayerColors(colors);
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError('An unknown error occurred');
            }
        } finally {
            setLoading(false);
        }
      };
  
      fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  
    const stringToColor = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      let color = '#';
      for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
      }
      return color;
    };
  
    const handlePlayerToggle = (playerName: string) => {
      setVisiblePlayers(prev =>
        prev.includes(playerName)
          ? prev.filter(p => p !== playerName)
          : [...prev, playerName]
      );
    };

    const selectAllPlayers = () => {
        setVisiblePlayers(performanceData.map(p => p.name));
    };
    
    const deselectAllPlayers = () => {
        setVisiblePlayers([]);
    };
  
    const chartData = {
      labels: uniqueDates.map(date => new Date(date).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })),
      datasets: performanceData
        .filter(player => visiblePlayers.includes(player.name))
        .map(player => {
          const performanceMap = new Map(player.performance.map(p => [p.match_date, p[metric]]));
          return {
            label: player.name,
            data: uniqueDates.map(date => performanceMap.get(date) ?? null),
            borderColor: playerColors[player.name] || '#000000',
            backgroundColor: playerColors[player.name] || '#000000',
            fill: false,
            tension: 0.1,
            spanGaps: true,
          };
        }),
    };

    const chartOptions = {
        responsive: true,
        plugins: {
            legend: {
                position: 'top' as const,
                labels: {
                    color: isDark ? '#e5e7eb' : undefined,
                },
            },
            title: {
                display: true,
                text: `Performance Chart: ${metric === 'hltv_2' ? 'HLTV 2.0 Rating' : 'ADR'}`,
                color: isDark ? '#e5e7eb' : undefined,
            },
            tooltip: {
                callbacks: {
                    // @ts-ignore
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += context.parsed.y.toFixed(2);
                        }
                        return label;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: false,
                title: {
                    display: true,
                    text: metric === 'hltv_2' ? 'HLTV 2.0' : 'ADR',
                    color: isDark ? '#e5e7eb' : undefined,
                },
                ticks: {
                    color: isDark ? '#9ca3af' : undefined,
                },
                grid: {
                    color: isDark ? 'rgba(255,255,255,0.08)' : undefined,
                },
            },
            x: {
                ticks: {
                    color: isDark ? '#9ca3af' : undefined,
                },
                grid: {
                    color: isDark ? 'rgba(255,255,255,0.08)' : undefined,
                },
            },
        }
    };
  
  if (loading && performanceData.length === 0) return <p>Loading...</p>;
    if (error) return <p>Error loading data: {error}</p>;

  return (
    <div>
      <div className="mb-4">
        {/* Metric selection */}
        <div className="flex items-center space-x-4 mb-4">
            <h3 className="text-lg font-semibold">Metric:</h3>
            <label>
              <input type="radio" name="metric" value="hltv_2" checked={metric === 'hltv_2'} onChange={() => setMetric('hltv_2')} />
              HLTV 2.0
            </label>
            <label>
              <input type="radio" name="metric" value="adr" checked={metric === 'adr'} onChange={() => setMetric('adr')} />
              ADR
            </label>
        </div>
        {/* Player Toggles */}
        <div className="mb-4">
            <h3 className="text-lg font-semibold">Players:</h3>
            <div className="flex items-center space-x-2 mb-2">
                <button onClick={selectAllPlayers} className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm">Select All</button>
                <button onClick={deselectAllPlayers} className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm">Deselect All</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {performanceData.map(player => (
                    <div key={player.name} className="flex items-center">
                        <input
                            type="checkbox"
                            id={`toggle-${player.name}`}
                            checked={visiblePlayers.includes(player.name)}
                            onChange={() => handlePlayerToggle(player.name)}
                            className="form-checkbox h-4 w-4 text-blue-600"
                            style={{ accentColor: playerColors[player.name] }}
                        />
                         <label htmlFor={`toggle-${player.name}`} className="ml-2 text-sm" style={{ borderLeft: `6px solid ${playerColors[player.name]}`, paddingLeft: '4px' }}>
                            {player.name}
                        </label>
                    </div>
                ))}
            </div>
        </div>
      </div>

       {/* Tabs */}
       <div className={`border-b mb-4 ${isDark ? 'border-dark-border' : 'border-gray-200'}`}>
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button onClick={() => setActiveTab('graph')} className={`${activeTab === 'graph' ? (isDark ? 'border-blue-400 text-blue-400' : 'border-blue-500 text-blue-600') : (isDark ? 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>
              Graph
            </button>
            <button onClick={() => setActiveTab('table')} className={`${activeTab === 'table' ? (isDark ? 'border-blue-400 text-blue-400' : 'border-blue-500 text-blue-600') : (isDark ? 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>
              Table
            </button>
          </nav>
        </div>

        <div>
            {activeTab === 'graph' && (
                <div>
                    {visiblePlayers.length > 0 ? (
                        <Line options={chartOptions} data={chartData} />
                    ) : (
                        <p className="text-center text-gray-500">No players selected to display on the graph.</p>
                    )}
                </div>
            )}
            {activeTab === 'table' && (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white border border-gray-200">
                        <thead>
                            <tr>
                                <th className="sticky left-0 bg-gray-100 px-3 py-2 z-10">Player</th>
                                {uniqueDates.map(date => (
                                    <th key={date} className="px-2 py-2 text-center">{new Date(date).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {performanceData.map(player => (
                                <tr key={player.name}>
                                    <td className="sticky left-0 bg-white px-3 py-2 z-10 font-medium">{player.name}</td>
                                    {uniqueDates.map(date => {
                                        const stat = player.performance.find(p => p.match_date === date);
                                        const value = stat ? stat[metric] : null;
                                        return (
                                            <td key={date} className="border-t px-2 py-2 text-center">
                                                {value !== null ? value.toFixed(2) : '-'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    </div>
  );
};

export default PerformanceGraphs; 
"use client";
import React, { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

function DuelloGrid({ data, isDark }: { data: any; isDark: boolean }) {
  if (!data || !data.playerRows || !data.playerCols || !data.duels) {
    return <div className="text-red-500 p-4">Veri yüklenemedi.</div>;
  }
  const { playerRows, playerCols, duels } = data;
  function renderCell(rowName: string, colName: string) {
    if (rowName === colName) {
      return <td key={colName} className={`border ${isDark ? 'bg-dark-border border-dark-border' : 'bg-gray-100'}`} />;
    }
    const duelData = duels[rowName]?.[colName] || { kills: 0, deaths: 0 };
    const reverseData = duels[colName]?.[rowName] || { kills: 0, deaths: 0 };
    const cellSize = 90;
    const rowKills = duelData.kills;
    const colKills = reverseData.kills;
    // Decide winner/loser/tie
    let winner: 'row' | 'col' | 'tie' | 'none' = 'tie';
    if (rowKills === 0 && colKills === 0) winner = 'none';
    else if (rowKills > colKills) winner = 'row';
    else if (colKills > rowKills) winner = 'col';
    // Colors - dark and light variants
    const green200 = isDark ? '#1a3a2a' : '#bbf7d0';  // dark: muted green, light: green-200
    const red200 = isDark ? '#3a1a1a' : '#fecaca';    // dark: muted red, light: red-200
    const softGray = isDark ? '#111827' : '#f3f4f6';  // dark: dark-card, light: gray-100
    const emptyBg = isDark ? '#0d1321' : '#fff';       // dark: dark-surface, light: white
    let bottomLeftBg = softGray;
    let topRightBg = softGray;
    let bottomLeftCircle = 'bg-gray-400';
    let topRightCircle = 'bg-gray-400';
    let diagLine = isDark ? '#374151' : '#cccccc';
    if (rowKills === 0 && colKills === 0) {
      // Both zero: teammates, no diagonal, no circles
      return <td key={colName} className={`${isDark ? 'border-dark-border' : 'border'}`} style={{ background: emptyBg, width: cellSize, height: cellSize, minWidth: cellSize, minHeight: cellSize, padding: 0 }} />;
    }
    if (winner === 'row') {
      bottomLeftBg = green200;
      topRightBg = red200;
      bottomLeftCircle = rowKills > 0 ? 'bg-green-600' : 'bg-gray-400';
      topRightCircle = colKills > 0 ? 'bg-red-600' : 'bg-gray-400';
    } else if (winner === 'col') {
      bottomLeftBg = red200;
      topRightBg = green200;
      bottomLeftCircle = rowKills > 0 ? 'bg-red-600' : 'bg-gray-400';
      topRightCircle = colKills > 0 ? 'bg-green-600' : 'bg-gray-400';
    } else if (winner === 'tie') {
      bottomLeftBg = softGray;
      topRightBg = softGray;
      bottomLeftCircle = rowKills > 0 ? 'bg-gray-400' : 'bg-gray-400';
      topRightCircle = colKills > 0 ? 'bg-gray-400' : 'bg-gray-400';
    }
    // SVG background
    const svg = `
      <svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' viewBox='0 0 100 100' preserveAspectRatio='none'>
        <polygon points='0,0 0,100 100,100' fill='${bottomLeftBg}'/>
        <polygon points='0,0 100,0 100,100' fill='${topRightBg}'/>
        <line x1='0' y1='0' x2='100' y2='100' stroke='${diagLine}' stroke-width='1'/>
      </svg>
    `;
    const encodedSvg = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n\s*/g, ''))}")`;
    function Circle({ count, color, pos, killer, killed }: any) {
      // Always render the circle, even for 0
      const style = {
        position: 'absolute' as const,
        width: 36, height: 36,
        fontSize: 16,
        top: pos === 'top-right' ? 10 : undefined,
        right: pos === 'top-right' ? 15 : undefined,
        bottom: pos === 'bottom-left' ? 10 : undefined,
        left: pos === 'bottom-left' ? 15 : undefined,
        zIndex: 1,
        cursor: 'pointer',
      };
      return (
        <div
          className={`duello-circle text-white font-bold rounded-full flex items-center justify-center ${color}`}
          style={style}
          title={`${killer} → ${killed}: ${count}`}
          onClick={() => alert(`${killer} → ${killed}: ${count}`)}
        >
          {count}
        </div>
      );
    }
    return (
      <td
        key={colName}
        className={`relative ${isDark ? 'border-dark-border' : 'border'}`}
        style={{
          width: cellSize,
          height: cellSize,
          minWidth: cellSize,
          minHeight: cellSize,
          padding: 0,
          overflow: 'hidden',
          backgroundImage: encodedSvg,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
        }}
      >
        <Circle count={rowKills} color={bottomLeftCircle} pos="bottom-left" killer={rowName} killed={colName} />
        <Circle count={colKills} color={topRightCircle} pos="top-right" killer={colName} killed={rowName} />
      </td>
    );
  }
  return (
    <div className="overflow-x-auto w-full">
      <table className="table-fixed border-collapse" style={{ minWidth: '1200px' }}>
        <thead>
          <tr>
            <th className={`w-32 p-3 font-semibold sticky left-0 z-10 ${isDark ? 'bg-dark-surface text-gray-300 border-dark-border' : 'border bg-gray-50 text-gray-700'}`}></th>
            {playerCols.map((col: string) => (
              <th key={col} className={`p-3 font-semibold text-center sticky top-0 z-10 min-w-[100px] ${isDark ? 'bg-dark-surface text-gray-300 border-dark-border' : 'border bg-gray-50'}`} title={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playerRows.map((row: string) => (
            <tr key={row}>
              <th className={`p-3 font-semibold sticky left-0 z-10 min-w-[120px] ${isDark ? 'bg-dark-surface text-gray-300 border-dark-border' : 'border bg-gray-50 text-gray-700'}`}>{row}</th>
              {playerCols.map((col: string) => renderCell(row, col))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DuelloTabsClient({ sonmacData: initialSonmac, sezonData: initialSezon }: { sonmacData: any, sezonData: any }) {
  const [tab, setTab] = useState<'sonmac' | 'sezon'>('sonmac');
  const [sonmacData, setSonmacData] = useState(initialSonmac);
  const [sezonData, setSezonData] = useState(initialSezon);
  const [loading, setLoading] = useState<boolean>(!initialSonmac?.playerRows?.length && !initialSezon?.playerRows?.length);
  const { isDark } = useTheme();

  // Fetch potential fresher data (incl. first load if files missing)
  useEffect(() => {
    const lastKnownTs = typeof window !== 'undefined' ? localStorage.getItem('stats_last_ts') : null;
    const url = `/api/stats/check${lastKnownTs ? `?lastKnownTs=${encodeURIComponent(lastKnownTs)}&` : '?'}_cb=${Date.now()}`;
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (j.duello_son_mac && j.duello_son_mac.playerRows) {
          setSonmacData(j.duello_son_mac);
        }
        if (j.duello_sezon && j.duello_sezon.playerRows) {
          setSezonData(j.duello_sezon);
        }
        if (j.serverTimestamp) {
          try { localStorage.setItem('stats_last_ts', j.serverTimestamp); } catch {}
        }
        setLoading(false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[DuelloTabsClient] sonmacData', sonmacData);
      console.log('[DuelloTabsClient] sezonData', sezonData);
    }
  }, [sonmacData, sezonData]);
  return (
    <div id="page-duello" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Düello</h2>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="duello-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${tab === 'sonmac' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`} onClick={() => setTab('sonmac')} type="button" role="tab">Son Maç</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${tab === 'sezon' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`} onClick={() => setTab('sezon')} type="button" role="tab">Sezon</button>
          </li>
        </ul>
      </div>
      {/* Tab Content */}
      <div id="duello-tab-content" className="relative">
        {loading && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center text-sm z-10 ${isDark ? 'bg-[#0d1321]/70 text-gray-300' : 'bg-white/70 text-gray-600'}`}>
            <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2" />
            Düello verileri yükleniyor...
          </div>
        )}
        {tab === 'sonmac' && <DuelloGrid data={sonmacData} isDark={isDark} />}
        {tab === 'sezon' && <DuelloGrid data={sezonData} isDark={isDark} />}
      </div>
    </div>
  );
}
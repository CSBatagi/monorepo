'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { NightStatColumn } from '@/lib/nightStatsColumns';
import HorizontalTableScroll from './HorizontalTableScroll';

const numeric = (value: unknown): number | null => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export default function NightStatsTable({ data, columns, label = 'Gece ortalaması' }: {
  data: Record<string, any>[]; columns: NightStatColumn[]; label?: string;
}) {
  const [sort, setSort] = useState({ key: columns[1].key, ascending: false });
  const ranges = useMemo(() => Object.fromEntries(columns.filter(col => col.heatmap).map(col => {
    const values = data.map(row => numeric(row[col.key])).filter((value): value is number => value !== null);
    return [col.key, { min: Math.min(...values), max: Math.max(...values) }];
  })), [columns, data]);
  const sorted = [...data].sort((a, b) => {
    if (sort.key === 'name') return String(a.name).localeCompare(String(b.name), 'tr') * (sort.ascending ? 1 : -1);
    const first = numeric(a[sort.key]), second = numeric(b[sort.key]);
    if (first === null) return second === null ? 0 : 1;
    if (second === null) return -1;
    return (first - second) * (sort.ascending ? 1 : -1);
  });
  return <HorizontalTableScroll label={`${label} istatistik tablosu`}>
    <table className="night-stats-table">
      <caption className="sr-only">{label}. Sütun başlıklarıyla sıralayabilirsiniz. Renkler düşükten yükseğe kırmızı, sarı ve yeşildir.</caption>
      <thead><tr>{columns.map(col => <th scope="col" key={col.key} aria-sort={sort.key === col.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => setSort(current => ({ key: col.key, ascending: current.key === col.key ? !current.ascending : col.key === 'name' }))}>{col.label.replace('HLTV2 DIFF', 'Δ HLTV 2').replace('ADR DIFF', 'Δ ADR').replace('Nr of Matches', 'Harita')}{sort.key === col.key ? sort.ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={11} />}</button></th>)}</tr></thead>
      <tbody>{sorted.map((row, index) => <tr key={row.steam_id || `${row.name}-${index}`}>{columns.map(col => {
        if (col.key === 'name') return <th scope="row" key={col.key}><span className="night-player"><small>{index + 1}</small><span>{row.name}</span></span></th>;
        const value = numeric(row[col.key]), range = ranges[col.key], difference = col.key.includes('DIFF');
        const ratio = value === null || !range || range.max === range.min ? null : (value - range.min) / (range.max - range.min);
        const hue = difference && value !== null ? value > 0 ? 140 : value < 0 ? 8 : 45 : ratio === null ? null : Math.round(ratio * 132 + 8);
        const style = col.heatmap && value !== null && hue !== null ? { '--stat-hue': hue } as CSSProperties : undefined;
        const formatted = value === null ? '—' : value.toLocaleString('tr-TR', { minimumFractionDigits: col.decimals ?? 0, maximumFractionDigits: col.decimals ?? 0, signDisplay: difference ? 'exceptZero' : 'auto' }) + (col.isPercentage ? '%' : '');
        return <td key={col.key}><span className={style ? 'night-stat-heat' : undefined} style={style}>{formatted}</span></td>;
      })}</tr>)}</tbody>
    </table>
    {!data.length && <p className="night-empty">Bu gece için oyuncu istatistiği bulunamadı.</p>}
  </HorizontalTableScroll>;
}

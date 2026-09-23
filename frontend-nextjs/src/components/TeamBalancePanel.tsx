import React from 'react';
import type { BalancePlayer, BalanceReport, BalanceSuggestion, BalanceVerdict } from '@/lib/teamBalance';

export interface BalancePlayerRow extends BalancePlayer {
  maps: number;
  mapMaps: number;
}

interface TeamBalancePanelProps {
  report: BalanceReport | null;
  teamAName: string;
  teamBName: string;
  teamARows: BalancePlayerRow[];
  teamBRows: BalancePlayerRow[];
  mapLabels: string[];
  ratingsAvailable: boolean;
  applyingIndex: number | null;
  message: string | null;
  onApply: (suggestion: BalanceSuggestion, index: number) => void;
}

const VERDICT_STYLES: Record<BalanceVerdict, { label: string; className: string }> = {
  balanced: { label: 'Dengeli', className: 'bg-green-100 text-green-800 border-green-300' },
  slight: { label: 'Hafif avantaj', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  unbalanced: { label: 'Dengesiz', className: 'bg-red-100 text-red-800 border-red-300' },
};

// Players with fewer maps than this are rated mostly from the newcomer prior.
const LOW_SAMPLE_MAPS = 10;

function formatGap(gap: number) {
  const abs = Math.abs(gap);
  return abs < 0.0005 ? '0.000' : abs.toFixed(3);
}

function formatPct(p: number) {
  return `%${Math.round(p * 100)}`;
}

function describeMoves(s: BalanceSuggestion, teamAName: string, teamBName: string) {
  const parts: string[] = [];
  if (s.toB.length) parts.push(`${s.toB.map((p) => p.name).join(', ')} → ${teamBName}`);
  if (s.toA.length) parts.push(`${s.toA.map((p) => p.name).join(', ')} → ${teamAName}`);
  return parts.join(' · ');
}

const RatingList: React.FC<{ title: string; rows: BalancePlayerRow[]; showMaps: boolean }> = ({ title, rows, showMaps }) => (
  <div className="flex-1 min-w-0">
    <div className="font-semibold text-gray-700 mb-1">{title}</div>
    <table className="w-full text-xs">
      <tbody>
        {[...rows].sort((a, b) => b.rating - a.rating).map((p) => (
          <tr key={p.steamId} className="border-b border-gray-100">
            <td className="py-0.5 pr-1 truncate">{p.name}</td>
            <td className="py-0.5 px-1 text-right font-mono">{p.rating.toFixed(2)}</td>
            <td className="py-0.5 pl-1 text-right text-gray-500 whitespace-nowrap">
              {p.maps < LOW_SAMPLE_MAPS ? 'yeni · ' : ''}{p.maps} harita{showMaps ? ` (${p.mapMaps} seçili haritada)` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TeamBalancePanel: React.FC<TeamBalancePanelProps> = ({
  report,
  teamAName,
  teamBName,
  teamARows,
  teamBRows,
  mapLabels,
  ratingsAvailable,
  applyingIndex,
  message,
  onApply,
}) => {
  if (!report) {
    return (
      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
        <h4 className="text-sm font-semibold text-gray-700 mb-1">Denge Önerisi</h4>
        {ratingsAvailable ? 'Denge hesaplamak için iki takıma da oyuncu ekle.' : 'Denge verisi yükleniyor...'}
      </div>
    );
  }

  const verdict = VERDICT_STYLES[report.verdict];
  const probA = report.probA;
  const mapText = mapLabels.length ? mapLabels.join(', ') : 'harita seçilmedi (genel puan)';

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h4 className="text-sm font-semibold text-gray-700">Denge Önerisi</h4>
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${verdict.className}`}>{verdict.label}</span>
      </div>
      <p className="text-[11px] text-gray-500 mb-2">Harita: {mapText}</p>

      <div className="flex justify-between text-xs font-medium mb-1">
        <span className="text-blue-700 truncate">{teamAName} {formatPct(probA)}</span>
        <span className="text-green-700 truncate">{formatPct(1 - probA)} {teamBName}</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded bg-gray-200" aria-hidden="true">
        <div className="bg-blue-500" style={{ width: `${probA * 100}%` }} />
        <div className="bg-green-500 flex-1" />
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        Güç {report.powerA.toFixed(3)} – {report.powerB.toFixed(3)} · fark {formatGap(report.gap)}
      </p>

      <div className="mt-3">
        {report.suggestions.length === 0 ? (
          <p className="text-xs text-gray-600">
            {report.verdict === 'balanced'
              ? 'Takımlar dengeli görünüyor, değişiklik önerilmiyor.'
              : report.verdict === 'slight'
                ? 'Küçük bir fark var ama geçmişte bu aralıkta sonuç yazı-turaydı; değişiklik önerilmiyor.'
                : 'Farkı anlamlı ölçüde azaltan bir değişiklik bulunamadı.'}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {report.suggestions.map((s, i) => (
              <li key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded border border-gray-200 bg-white p-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 break-words">{describeMoves(s, teamAName, teamBName)}</div>
                  <div className="text-gray-500">
                    fark {formatGap(report.gap)} → {formatGap(s.gap)} · {teamAName} {formatPct(s.probA)}
                  </div>
                </div>
                <button
                  type="button"
                  className="self-start sm:self-auto rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => onApply(s, i)}
                  disabled={applyingIndex !== null}
                >
                  {applyingIndex === i ? 'Uygulanıyor…' : 'Uygula'}
                </button>
              </li>
            ))}
          </ol>
        )}
        {message && <p className="mt-2 text-xs text-gray-600" role="status">{message}</p>}
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-gray-600">Oyuncu denge puanları</summary>
        <div className="mt-2 flex flex-col md:flex-row gap-3">
          <RatingList title={teamAName} rows={teamARows} showMaps={mapLabels.length > 0} />
          <RatingList title={teamBName} rows={teamBRows} showMaps={mapLabels.length > 0} />
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Puan: son 150 haritanın HLTV 2.0 ortalaması (az maçı olan oyuncular 0.90&apos;a çekilir), seçili haritadaki geçmişle
          düzeltilir. Takım gücü = ortalama + 0.2 × en iyi oyuncu. Son 10 / sezon ortalamaları geçmişte kazananı tahmin etmediği
          için kullanılmaz.
        </p>
      </details>
      <p className="mt-2 text-[11px] text-gray-500">
        Öneriler mevcut seçimi değiştirmez; oyuncular yalnızca &quot;Uygula&quot;ya basıp onaylarsan yer değiştirir.
      </p>
    </div>
  );
};

export default TeamBalancePanel;

'use client';

import { useState } from 'react';
import { formatClock, type AnalysisServerState } from '@/lib/demos';

const PHASE: Record<AnalysisServerState['vm'], { text: string; dot: string }> = {
  running: { text: 'Açık', dot: 'bg-emerald-500' },
  starting: { text: 'Açılıyor', dot: 'bg-amber-500 animate-pulse' },
  stopping: { text: 'Kapanıyor', dot: 'bg-amber-500 animate-pulse' },
  stopped: { text: 'Kapalı', dot: 'bg-gray-400' },
  unknown: { text: 'Bilinmiyor', dot: 'bg-gray-400' },
};

function describe(state: AnalysisServerState, queued: number): { text: string; warn?: boolean } {
  const idle = `${state.idleMinutes} dk`;
  switch (state.vm) {
    case 'starting':
      return { text: 'Açıldıktan sonra sıradaki demolar birkaç dakika içinde işlenir.' };
    case 'stopping':
      return { text: state.startPending ? 'Kapanınca sıradaki demolar için yeniden açılacak.' : '' };
    case 'running':
      if (!state.autoStop) return { text: 'Maç için açıldı; otomatik kapanmaz. Analizler bu arada da işlenir.' };
      if (state.busy) return { text: `${state.busy.text || ''} Sunucu boşaldıktan ${idle} sonra otomatik kapanır.`.trim() };
      if (state.stopAt) return { text: `Boşta; ${formatClock(state.stopAt)} civarında otomatik kapanacak.` };
      return { text: `Analizler bitip ${idle} boşta kalınca otomatik kapanır.` };
    case 'stopped':
      if (state.lastEvent === 'start_failed') return { text: 'Sunucu açılamadı; tekrar deneyin.', warn: true };
      if (queued > 0) return { text: 'Sırada demo var; sunucu açılınca işlenir.' };
      if (state.stoppedAutomatically && state.stoppedAt) return { text: `${idle} boşta kaldığı için ${formatClock(state.stoppedAt)} civarında otomatik kapatıldı.` };
      return { text: state.autoStart ? `"Analiz et" sunucuyu otomatik açar; iş bitince ${idle} boşta kalırsa kapanır.` : 'Otomatik açma kapalı.' };
    default:
      return { text: 'Sunucu durumu alınamadı.' };
  }
}

/** Admin view of the game VM as the analysis machine, with open/close controls. */
export default function AnalysisServerPanel({ state, queued, analyzing, isDark, onChanged }: {
  state: AnalysisServerState;
  queued: number;
  analyzing: number;
  isDark: boolean;
  onChanged: (message: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const phase = PHASE[state.vm] || PHASE.unknown;
  const description = describe(state, queued);
  const pendingWork = queued + analyzing > 0;

  const act = async (action: 'start' | 'stop') => {
    if (action === 'stop' && !confirm('Oyun sunucusu kapatılsın mı? Sunucuda oyuncu ya da süren iş varsa kapatılmaz.')) return;
    setWorking(true);
    try {
      const response = await fetch('/api/demos/server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) onChanged(`Hata: ${data.error || response.status}`);
      else if (action === 'stop') onChanged(data.stopped ? 'Oyun sunucusu kapatıldı.' : 'Oyun sunucusu zaten kapalı.');
      else onChanged(data.started ? 'Oyun sunucusu açılıyor; sıradaki demolar birkaç dakika içinde işlenir.' : 'Oyun sunucusu zaten açık ya da açılıyor.');
    } catch {
      onChanged('İstek gönderilemedi.');
    } finally {
      setWorking(false);
    }
  };

  const button = 'rounded border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-dark-border bg-dark-surface' : 'border-gray-200 bg-white'}`}>
      <span className="font-medium">Analiz sunucusu</span>
      <span className="flex items-center gap-1.5 text-xs">
        <span className={`inline-block h-2 w-2 rounded-full ${phase.dot}`} />
        {phase.text}
      </span>
      {description.text && <span className={`text-xs ${description.warn ? 'text-red-600' : 'text-gray-500 dark:text-gray-400'}`}>{description.text}</span>}
      <span className="ml-auto flex gap-2">
        {state.vm === 'stopped' && (pendingWork || state.lastEvent === 'start_failed') && (
          <button type="button" disabled={working || !state.autoStart} onClick={() => void act('start')}
            className={`${button} border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30`}>
            Sunucuyu aç
          </button>
        )}
        {state.vm === 'running' && (
          <button type="button" disabled={working || pendingWork} onClick={() => void act('stop')}
            title={pendingWork ? 'Sıradaki analizler bitince kapatılabilir' : undefined}
            className={`${button} border-red-600 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30`}>
            Sunucuyu kapat
          </button>
        )}
      </span>
    </div>
  );
}

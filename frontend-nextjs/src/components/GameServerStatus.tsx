'use client';

import type { GamePhase, GameStatus } from '@/lib/useGameServerStatus';

export default function GameServerStatus({ status, phase, pending }: { status: GameStatus | null; phase: GamePhase; pending: 'starting' | 'stopping' | null }) {
  const label = pending === 'starting' ? 'Başlatılıyor' : pending === 'stopping' ? 'Kapatılıyor' : phase === 'loading' ? 'Kontrol ediliyor' : phase === 'unauthorized' ? 'Üye girişi gerekli' : phase === 'offline' ? 'Sunucuya ulaşılamıyor' : status?.preparing ? 'Maç hazırlanıyor' : status?.paused ? 'Maç duraklatıldı' : status?.live ? 'Maç canlı' : 'Hazır';
  return <div className="game-server-status" data-phase={pending || phase} role="status"><strong><i />{label}</strong>{status && <span>{status.map?.replace(/^de_/, '')} · {status.humans} oyuncu</span>}</div>;
}

'use client';

import type { GamePhase, GameStatus } from '@/lib/useGameServerStatus';

export default function GameServerStatus({ status, phase, pending }: { status: GameStatus | null; phase: GamePhase; pending: 'starting' | 'stopping' | null }) {
  const stages = { checking: 'Güncellemeler kontrol ediliyor', updating_game: 'CS2 güncelleniyor', updating_plugins: 'Eklentiler güncelleniyor', verifying: 'Sunucu doğrulanıyor', ready: 'Hazır', failed: 'Sunucu başlatılamadı' };
  const label = pending === 'stopping' ? 'Kapatılıyor' : phase === 'failed' ? stages.failed : phase === 'updating' ? stages[status?.update?.stage || 'verifying'] : pending === 'starting' ? 'Başlatılıyor' : phase === 'loading' ? 'Kontrol ediliyor' : phase === 'unauthorized' ? 'Üye girişi gerekli' : phase === 'offline' ? 'Sunucuya ulaşılamıyor' : status?.preparing ? 'Maç hazırlanıyor' : status?.paused ? 'Maç duraklatıldı' : status?.live ? 'Maç canlı' : 'Hazır';
  return <div className="game-server-status" data-phase={pending || phase} role="status"><strong><i />{label}</strong>{phase === 'failed' ? <span>Güncelleme veya eklenti kontrolü başarısız. Bir yöneticiye haber ver.</span> : status?.map && <span>{status.map.replace(/^de_/, '')} · {status.humans} oyuncu</span>}</div>;
}

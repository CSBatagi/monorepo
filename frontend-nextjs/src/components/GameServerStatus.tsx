'use client';

import type { GamePhase, GameStatus } from '@/lib/useGameServerStatus';

export default function GameServerStatus({ status, phase, pending }: {
  status: GameStatus | null;
  phase: GamePhase;
  pending: 'starting' | 'stopping' | null;
}) {
  const message =
    phase === 'unauthorized' ? 'Sunucu yönetimi için yönetici hesabıyla giriş yapın.'
    : pending === 'starting' ? 'Sunucu başlatılıyor, hazır olunca burada görünecek.'
    : pending === 'stopping' ? 'Sunucu kapatılıyor...'
    : phase === 'loading' ? 'Sunucu durumu alınıyor...'
    : phase === 'offline' ? 'Sunucu kapalı. Oynamak için Server Aç.'
    : '';
  return <div className="w-full rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
    <div className="font-semibold">CS Batagi oyun sunucusu · en fazla 10 vs 10</div>
    <a className="text-blue-700 underline" href="steam://connect/cs2.csbatagi.com:27015">CS2 ile bağlan</a>
    <p className="mt-1">Isınma: .guns · Hazır: .ready · Duraklat: .pause · Devam: .unpause</p>
    {message && <p className="mt-2">{message}</p>}
    {status && <div className="mt-2 space-y-1">
      <p>{status.map} · {status.humans} oyuncu · {status.preparing ? 'Demo kontrolü' : status.live ? 'Maç canlı' : 'Süresiz ısınma'}</p>
      <p className={status.demoFailed ? 'font-semibold text-red-700' : ''}>Demo: {status.demoFailed ? 'Kayıt sorunu — yönetici müdahalesi gerekiyor' : status.recording ? `Kaydediliyor (${(status.bytes / 1048576).toFixed(1)} MB)` : 'Canlı maç başlayınca otomatik kaydedilir'}</p>
      <p>Arşiv: {status.uploads ? status.uploads.pending ? `${status.uploads.pending} dosya kayıt/yükleme bekliyor` : 'Tüm demolar doğrulandı' : 'Durum bekleniyor'}</p>
    </div>}
  </div>;
}

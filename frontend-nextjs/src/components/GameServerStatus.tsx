'use client';

import { useEffect, useState } from 'react';

type Status = { warmup: boolean; live: boolean; preparing: boolean; recording: boolean; demoFailed: boolean;
  map: string; humans: number; bytes: number; uploads?: { pending: number; demos: { name: string; state: string }[] } };

export default function GameServerStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/game-status', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) { setMessage('Sunucu yönetimi için yönetici hesabıyla giriş yapın.'); return; }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!disposed) { setStatus(data); setMessage(''); }
      } catch { if (!disposed) { setStatus(null); setMessage('Sunucuya ulaşılamıyor veya sunucu başlatılıyor.'); } }
      if (!disposed) timeout = setTimeout(refresh, 15000);
    }
    void refresh();
    return () => { disposed = true; clearTimeout(timeout); };
  }, []);
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

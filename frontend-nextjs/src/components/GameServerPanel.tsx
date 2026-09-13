'use client';

import { useRef, type ReactNode } from 'react';
import { Power, Server } from 'lucide-react';
import GameServerStatus from './GameServerStatus';
import GameServerConnect from './GameServerConnect';
import type { GameStatus, GamePhase } from '@/lib/useGameServerStatus';
import './game-server.css';

export default function GameServerPanel({ status, phase, pending, starting, stopping, startReason, stopReason, message, onStart, onStop, adminTools }: {
  status: GameStatus | null; phase: GamePhase; pending: 'starting' | 'stopping' | null;
  starting: boolean; stopping: boolean; startReason: string | null; stopReason: string | null;
  adminTools?: ReactNode; message: string | null; onStart: () => void; onStop: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <section id="game-server" className="game-server-panel" aria-labelledby="game-server-title">
    <div className="game-server-heading"><div><span className="game-server-eyebrow"><Server size={15} /> MAÇ ÖNCESİ</span><h2 id="game-server-title">Sunucu & bağlantı</h2><p>Kulüpteki herkes sunucuyu açıp kapatabilir.</p></div><GameServerStatus status={status} phase={phase} pending={pending} /></div>
    <div className="game-server-main"><div className="game-server-power"><div><button className="game-server-start" onClick={onStart} disabled={starting || !!pending || startReason !== null} aria-describedby="server-start-note"><Power size={17} />{starting || pending === 'starting' ? 'Başlatılıyor…' : phase === 'online' ? 'Sunucu açık' : 'Sunucuyu aç'}</button><p id="server-start-note">{startReason || 'Hazır olduğunda durum otomatik güncellenir.'}</p></div><div><button onClick={() => dialog.current?.showModal()} disabled={stopping || !!pending || stopReason !== null} aria-describedby="server-stop-note"><Power size={17} />{stopping || pending === 'stopping' ? 'Kapatılıyor…' : 'Sunucuyu kapat'}</button><p id="server-stop-note">{stopReason || 'İşiniz bitince kapatabilirsiniz.'}</p></div></div><GameServerConnect /></div>
    {message && <p className="game-server-feedback" role="status">{message}</p>}
    <details className="game-server-help"><summary>İlk kez bağlanıyorum · Oyun içi komutlar</summary><div className="game-server-guide"><div><h3>1. Sunucuyu aç</h3><p>“Hazır” durumunu bekle. Başlatma birkaç dakika sürebilir.</p></div><div><h3>2. CS2 ile bağlan</h3><p>Steam ve CS2 yüklü bilgisayarında bağlantıyı aç. İstenirse kulübün sunucu şifresini gir.</p></div><div><h3>3. Takımına katıl</h3><p>Takımlar ve haritalar seçildikten sonra yönetici maçı oluşturur. İki takım da hazır olunca maç başlar.</p></div></div><dl className="game-server-commands"><div><dt><code>.guns</code></dt><dd>Isınmada silah seç</dd></div><div><dt><code>.ready</code></dt><dd>Maça hazırım</dd></div><div><dt><code>.pause</code></dt><dd>Maçı duraklat</dd></div><div><dt><code>.unpause</code></dt><dd>Devam et · iki takım da yazar</dd></div></dl></details>
    <details className="game-server-help"><summary>Demo kaydı ve arşiv</summary><p>{status?.demoFailed ? 'Kayıt sorunu var. Bir yöneticiye haber ver.' : status?.recording ? `Demo kaydediliyor · ${(status.bytes / 1048576).toFixed(1)} MB` : 'Canlı maç başlayınca demo otomatik kaydedilir.'} {status?.uploads ? status.uploads.pending ? `${status.uploads.pending} dosyanın arşivlenmesi bekleniyor.` : 'Tüm demo yüklemeleri doğrulandı.' : 'Arşiv durumu bekleniyor.'}</p><p>Maç veya kayıt sürerken, demoların yüklenmesi tamamlanmadan sunucu kapatılamaz.</p><a href="/demolar">Demoları ve analiz durumunu aç ↗</a></details>
    {adminTools && <details className="game-server-help"><summary>Yönetici araçları</summary>{adminTools}</details>}
    <dialog ref={dialog} className="game-server-confirm" aria-labelledby="server-stop-title"><h2 id="server-stop-title">Sunucu kapatılsın mı?</h2><p>Bağlı oyuncuların bağlantısı kesilir. Canlı maç ve demo kayıtları sunucu tarafından korunur.</p><div><button autoFocus onClick={() => dialog.current?.close()}>Vazgeç</button><button className="game-server-stop" disabled={stopping || !!pending || stopReason !== null} onClick={() => { dialog.current?.close(); onStop(); }}>Sunucuyu kapat</button></div></dialog>
  </section>;
}

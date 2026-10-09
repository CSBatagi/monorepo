'use client';

import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { useGameServerStatus, type GameStatus } from '@/lib/useGameServerStatus';
import './game-server.css';

export default function GameServerConnect({ disabled = false, status }: { disabled?: boolean; status?: GameStatus | null }) {
  // The team picker shares its existing poll; the equipment page polls independently.
  const polled = useGameServerStatus(false, status === undefined);
  const current = status === undefined ? polled.status : status;
  const address = current?.connection?.address;
  const unavailable = disabled || !address || current?.serverReady === false || (status === undefined && polled.phase !== 'online');
  const command = address ? `connect ${address}` : '';
  const launchUrl = address ? `steam://run/730//${encodeURIComponent(`+${command}`)}/` : undefined;
  const [copyMessage, setCopyMessage] = useState('');
  async function copyCommand() {
    if (unavailable) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopyMessage('Kopyalandı. CS2 konsoluna yapıştırın.');
    } catch {
      setCopyMessage('Aşağıdaki komutu seçip kopyalayabilirsiniz.');
    }
  }
  return <div className="game-server-connect">
    <a className="game-server-join" href={unavailable ? undefined : launchUrl} aria-disabled={unavailable} tabIndex={unavailable ? -1 : undefined}><ExternalLink size={17} />{unavailable ? 'Sunucunun hazır olmasını bekle' : 'CS2 ile bağlan'}</a>
    <span className="game-server-address">{address || 'Sunucu hazır olduğunda bağlantı adresi burada görünür.'}</span>
    <details><summary>Bağlantı açılmadı mı?</summary><p>CS2 ayarlarında geliştirici konsolunu etkinleştir. Konsolu açıp bu komutu yapıştır; istenirse sunucu şifresini gir.</p>{command && <div className="game-server-copy"><code>{command}</code><button type="button" disabled={unavailable} onClick={copyCommand}><Copy size={14} /> Kopyala</button></div>}<p role="status">{copyMessage}</p></details>
  </div>;
}

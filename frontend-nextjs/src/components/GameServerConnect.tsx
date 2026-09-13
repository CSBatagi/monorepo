'use client';

import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import './game-server.css';

// Reserved public game IP. Launch CS2 explicitly instead of Steam's generic server browser.
const address = '34.159.222.148:27015';
const command = `connect ${address}`;
const launchUrl = `steam://run/730//${encodeURIComponent(`+${command}`)}/`;

export default function GameServerConnect() {
  const [copyMessage, setCopyMessage] = useState('');
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyMessage('Kopyalandı. CS2 konsoluna yapıştırın.');
    } catch {
      setCopyMessage('Aşağıdaki komutu seçip kopyalayabilirsiniz.');
    }
  }
  return <div className="game-server-connect">
    <a className="game-server-join" href={launchUrl}><ExternalLink size={17} /> CS2 ile bağlan</a>
    <span className="game-server-address">{address}</span>
    <details><summary>Bağlantı açılmadı mı?</summary><p>CS2 ayarlarında geliştirici konsolunu etkinleştir. Konsolu açıp bu komutu yapıştır; istenirse sunucu şifresini gir.</p><div className="game-server-copy"><code>{command}</code><button type="button" onClick={copyCommand}><Copy size={14} /> Kopyala</button></div><p role="status">{copyMessage}</p></details>
  </div>;
}

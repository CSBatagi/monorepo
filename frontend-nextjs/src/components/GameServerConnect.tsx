'use client';

import { useState } from 'react';

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
  return <div className="space-y-1">
    <a className="text-blue-700 underline dark:text-blue-400" href={launchUrl}>CS2 ile bağlan</a>
    <div className="flex flex-wrap items-center gap-2">
      <code className="select-all break-all">{command}</code>
      <button type="button" className="underline" onClick={copyCommand}>Komutu kopyala</button>
    </div>
    <p>Bağlantı açılmazsa komutu CS2 konsoluna yapıştırın. Sunucu şifresi gerekir.</p>
    <p role="status" aria-live="polite">{copyMessage}</p>
  </div>;
}

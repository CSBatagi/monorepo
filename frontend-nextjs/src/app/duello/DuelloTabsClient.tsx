'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import { DuelMatrix } from '@/components/NightDuels';
import type { MatchDuels } from '@/lib/matchDuels';
import '@/components/night-center.css';

type SeasonDuels = { playerRows: string[]; duels: Record<string, Record<string, { kills: number; deaths: number }>> };

export default function DuelloTabsClient({ sezonData }: { sezonData: SeasonDuels }) {
  const [data, setData] = useState(sezonData);
  useStatsRefresh({ keys: ['duello_sezon'], onData: payload => {
    if (payload.duello_sezon?.playerRows) setData(payload.duello_sezon);
  } });
  const matrix: MatchDuels = {
    players: data.playerRows.map(name => ({ steam_id: name, name })),
    kills: Object.fromEntries(Object.entries(data.duels).map(([player, opponents]) => [player, Object.fromEntries(Object.entries(opponents).map(([opponent, duel]) => [opponent, duel.kills]))])),
  };
  return <div id="page-duello" className="page-content page-content-container night-center">
    <header className="night-center-heading"><div><p>REKABET</p><h1>Sezon Düelloları</h1><p>Sezon boyunca kim, kime üstünlük kurmuş?</p></div></header>
    <Link className="duel-night-link" prefetch={false} href="/gece-ortalama?gorunum=duello">Gece ve harita düelloları artık Gece & Maçlar’da →</Link>
    <section className="night-data-panel"><DuelMatrix data={matrix} label="Güncel sezon · Düello toplamları" /></section>
  </div>;
}

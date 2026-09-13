'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { ArrowUpRight, Crown } from 'lucide-react';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import { summarizeLastNight, type NightBriefing } from '@/lib/cinematicBriefing';
import './last-night.css';

const signed = (value: number | null, digits = 2) => value === null ? '—' : value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' });

export default function LastNightCard() {
  const titleId = useId();
  const [night, setNight] = useState<NightBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(false);
  useStatsRefresh({ keys: ['night_avg_periods', 'sonmac_by_date_periods'],
    onData: payload => { setNight(summarizeLastNight(payload)); setSnapshot(Boolean(payload.backendUnavailable)); },
    onSettled: () => setLoading(false),
  });
  return <section className="last-night-card" aria-labelledby={titleId}>
    <header><h2 id={titleId}>Son gece kim taşımış, kim yatmış?</h2>{night && <time dateTime={night.date}>{new Date(`${night.date}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time>}</header>
    {night ? <>
      <div className="last-night-meta"><span>SON OYNANAN GECE</span><span>{night.maps.length} harita · {night.playerCount} oyuncu{snapshot ? ' · kayıtlı veri' : ''}</span></div>
      <div className="last-night-rankings">{([{ key: 'leaders', title: 'Taşıyanlar', empty: 'Bu gece beklentisini aşan oyuncu yok.' }, { key: 'bottom', title: 'Yatanlar', empty: 'Bu gece beklentisinin altında kalan oyuncu yok.' }] as const).map(group => <div className={`last-night-group ${group.key}`} key={group.key}>
        <h3>{group.key === 'leaders' ? <Crown size={17} /> : <span className="golden-poop" role="img" aria-label="Altın kaka">💩</span>}{group.title}</h3>
        {(night[group.key].length > 0) ? <table><thead><tr><th scope="col">Oyuncu</th><th scope="col">Δ HLTV 2</th><th scope="col">Δ ADR</th><th scope="col">Puan</th></tr></thead><tbody>{night[group.key].map((player, index) => <tr key={player.steamId || player.name}><th scope="row"><span className="last-night-player"><small>{index + 1}</small><span>{player.name}</span>{index === 0 && (group.key === 'leaders' ? <Crown size={13} aria-label="Gecenin taşıyanı" /> : <span className="golden-poop" role="img" aria-label="Gecenin yatanı">💩</span>)}</span></th><td>{signed(player.hltvDiff)}</td><td>{signed(player.adrDiff, 1)}</td><td><strong>{signed(player.score, 1)}</strong></td></tr>)}</tbody></table> : <p className="last-night-empty">{night.rankedCount ? group.empty : 'Karşılaştırma için geçmiş performans verisi henüz hazır değil.'}</p>}
      </div>)}</div>
      <details className="last-night-method"><summary>Bu sıralama neye göre?</summary><p>Aylık performans ödülleriyle aynı hesap: <b>puan = HLTV 2 farkı × 70 + ADR farkı</b>. Farklar, oyuncunun önceki 10 kayıtlı oyun tarihindeki maç ortalamasına göredir. Artı puan beklentinin üstü, eksi puan altıdır. En yüksek üç artı ve en düşük üç eksi gösterilir; geçmişi olmayanlar sıralanmaz.</p></details>
      <div className="last-night-maps">{night.maps.slice(0, 3).map((map, index) => <div key={`${map.name}-${index}`}><span>{map.name}</span><span>{map.team1}</span><strong>{map.score1 ?? '—'} : {map.score2 ?? '—'}</strong><span>{map.team2}</span></div>)}</div>
    </> : <p className="last-night-empty" role="status">{loading ? 'Skor tabelası geliyor. Bahaneleri hazırlayın.' : 'Bu sezonun gece özeti henüz yok. Arşivdeki geceler duruyor.'}</p>}
    <footer><Link prefetch={false} href="/gece-ortalama">Gece ortalamaları <ArrowUpRight size={14} /></Link><Link prefetch={false} href="/sonmac">Maç detayları <ArrowUpRight size={14} /></Link></footer>
  </section>;
}

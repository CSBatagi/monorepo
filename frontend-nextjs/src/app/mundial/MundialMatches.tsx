'use client';

import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { CaptainRecord } from '@/lib/batakAllStars';
import type { MundialMatchNight } from '@/lib/mundial';
import { computeMapPoints, type SuperligaConfig } from '@/lib/superliga';
import styles from './mundial.module.css';

const STATUS_LABELS = {
  included: 'Grup puanına dahil',
  'missing-captains': 'Kaptan ataması eksik',
  'missing-results': 'Maç sonucu / kadro eksik',
  'after-groups': 'Grup aşaması dışında',
};
const SOURCES = { demo: 'Demo', override: 'Elle eklenen harita', manual: 'Manuel gece' };
const score = (value: number) => Number.isFinite(value) ? value : '—';

function Captain({ captain, nameOf }: { captain?: CaptainRecord | null; nameOf: (id: string) => string }) {
  return <span>{captain?.steamId ? nameOf(captain.steamId) : 'Atanmadı'}</span>;
}

export default function MundialMatches({ nights, scoring, groupStageLength, nameOf, loading, error, onRetry }: {
  nights: MundialMatchNight[];
  scoring: SuperligaConfig['scoring'];
  groupStageLength: number;
  nameOf: (id: string) => string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const included = nights.filter((night) => night.status === 'included');
  const countedMaps = included.reduce((n, night) => n + night.maps.filter((map) => !map.excludedReason).length, 0);
  const visible = useMemo(() => nights.filter((night) => filter === 'all' || (filter === 'included' ? night.status === 'included' : night.status !== 'included')), [nights, filter]);

  if (error) return (
    <div className={styles.panel} role="alert">
      <p className={styles.errorMessage}>Kaptan veya manuel maç verileri alınamadı. Maçların hesaba katılma durumu şu anda doğrulanamıyor.</p>
      <button type="button" className={`${styles.ghostButton} mt-3`} onClick={onRetry}>Tekrar dene</button>
    </div>
  );
  if (loading) return <div className={styles.panel} role="status">Maç sonuçları ve kaptanlar yükleniyor…</div>;

  return (
    <div className={styles.matchList}>
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}><ClipboardList className="h-5 w-5" />Maçlar ve Sonuçlar</h3>
        <p className={styles.muted}>Grup puanına dahil edilen geceler, harita sonuçları ve kaptanlar. İlk {groupStageLength} kaptan atanmış gece grup aşamasına sayılır.</p>
        <p className={styles.muted}>Kayıtlarda görünmeyen haritalar otomatik tespit edilemez. Oynadığınız bir harita bu listede yoksa eksik sonucu yöneticilere bildirin.</p>
        <div className={styles.matchToolbar}>
          <b>{included.length}/{groupStageLength} gece · {countedMaps} harita sayıldı</b>
          <label className={styles.matchFilter}>
            Göster
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">Tüm geceler ({nights.length})</option>
              <option value="included">Sayılan geceler ({included.length})</option>
              <option value="excluded">Sayılmayan geceler ({nights.length - included.length})</option>
            </select>
          </label>
        </div>
      </section>

      {visible.length === 0 && <p className={`${styles.panel} ${styles.muted}`}>{nights.length ? 'Bu filtreye uygun gece yok.' : 'Bu sezon için henüz maç kaydı yok.'}</p>}

      {visible.map((night) => (
        <article key={night.date} className={styles.panel}>
          <div className={styles.matchHeading}>
            <h4 className={styles.panelTitle}><time dateTime={night.date}>{night.date}</time>{night.nightNumber && <span className={styles.muted}>· {night.nightNumber}. gece</span>}</h4>
            <span className={styles.matchStatus} data-included={night.status === 'included'}>{STATUS_LABELS[night.status]}</span>
          </div>
          <div className={styles.matchCaptains}>
            <span><b>{night.captains?.team1?.teamName || 'Takım 1'} kaptanı:</b> <Captain captain={night.captains?.team1} nameOf={nameOf} /></span>
            <span><b>{night.captains?.team2?.teamName || 'Takım 2'} kaptanı:</b> <Captain captain={night.captains?.team2} nameOf={nameOf} /></span>
          </div>
          {night.status === 'missing-captains' && <p className={styles.message}>Her iki takımın kaptanı atanınca bu gece hesaba katılabilir.</p>}
          {night.status === 'after-groups' && <p className={styles.muted}>İlk {groupStageLength} sayılan geceden sonra oynandı; grup sıralamasını etkilemez. Eleme sonuçları Eleme Tablosu sekmesindedir.</p>}
          {night.maps.length === 0 && <p className={styles.message}>Bu gece için harita sonucu bulunamadı.</p>}
          <div className={styles.matchMaps}>
            {night.maps.map((map, index) => {
              const counted = night.status === 'included' && !map.excludedReason;
              const points1 = computeMapPoints(map.team1Score, map.team2Score, scoring);
              const points2 = computeMapPoints(map.team2Score, map.team1Score, scoring);
              return (
                <div key={`${map.source}-${map.mapName}-${index}`} className={styles.matchMap}>
                  <div className={styles.matchMapTitle}><b>{map.mapName.replace(/^de_/, '')}</b><span className={styles.muted}>{SOURCES[map.source]}</span></div>
                  <div className={styles.matchScore}>
                    <span className={map.team1Score > map.team2Score ? styles.resultWinner : ''}>{map.team1Name}</span>
                    <b>{score(map.team1Score)} – {score(map.team2Score)}</b>
                    <span className={map.team2Score > map.team1Score ? styles.resultWinner : ''}>{map.team2Name}</span>
                  </div>
                  <p className={counted ? styles.matchCounted : styles.muted}>
                    {counted ? `Sayıldı · Oyuncu başına harita puanı: ${points1?.points} / ${points2?.points}` : `Sayılmadı · ${map.excludedReason || STATUS_LABELS[night.status]}`}
                  </p>
                  <details className={styles.matchRosters}>
                    <summary>Takım kadroları</summary>
                    <p><b>{map.team1Name}:</b> {map.team1Ids.filter(Boolean).map(nameOf).join(', ') || 'Kadro yok'}</p>
                    <p><b>{map.team2Name}:</b> {map.team2Ids.filter(Boolean).map(nameOf).join(', ') || 'Kadro yok'}</p>
                  </details>
                </div>
              );
            })}
          </div>
          {night.status === 'included' && <p className={`${styles.muted} mt-3`}>Kaptan bonusu: gece başına +{scoring.captainBonus} puan. Harita puanları yukarıdaki takım sırasıyla gösterilir.</p>}
        </article>
      ))}
    </div>
  );
}

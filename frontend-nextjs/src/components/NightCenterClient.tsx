'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { BarChart3, ChevronLeft, ChevronRight, Crosshair, Moon, SlidersHorizontal, Users } from 'lucide-react';
import { buildPeriodWindowOptions, isDateKeyedPeriodPayload, loadDateKeyedPeriodSelection, type DateKeyedPeriodPayload } from '@/lib/statsPeriods';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import { nightAvgColumns } from '@/lib/nightStatsColumns';
import NightStatsTable from './NightStatsTable';
import SonMacClient from './SonMacClient';
import './night-center.css';

const RadarGraphs = dynamic(() => import('./SeasonAvgRadarGraphs').then(module => module.RadarGraphs));
const H2HClient = dynamic(() => import('./H2HClient'));
type Rows = Record<string, any>[];
type NightMatches = { maps?: Record<string, any> };
const formatDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function NightCenterClient({ nightPayload: initialNight, matchPayload: initialMatches, seasonStarts }: {
  nightPayload: DateKeyedPeriodPayload<Rows>; matchPayload: DateKeyedPeriodPayload<NightMatches>; seasonStarts: string[];
}) {
  const params = useSearchParams();
  const [nightPayload, setNightPayload] = useState(initialNight);
  const [matchPayload, setMatchPayload] = useState(initialMatches);
  const [nightPeriods, setNightPeriods] = useState(initialNight.data || {});
  const [matchPeriods, setMatchPeriods] = useState(initialMatches.data || {});
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [detailed, setDetailed] = useState(false);
  const [analysis, setAnalysis] = useState<'table' | 'graph' | 'h2h'>('table');
  const [snapshot, setSnapshot] = useState(false);
  const optionsPayload = nightPayload.periods?.length ? nightPayload : matchPayload;
  const seasonOptions = useMemo(() => buildPeriodWindowOptions<unknown>(optionsPayload, seasonStarts, []), [optionsPayload, seasonStarts]);
  const requestedSeason = params.get('sezon');
  const periodId = seasonOptions.some(option => option.id === requestedSeason) ? requestedSeason! : optionsPayload.current_period || seasonOptions[0]?.id || 'all_time';
  const nightData = nightPeriods[periodId] || {};
  const matchData = matchPeriods[periodId] || {};
  const dates = [...new Set([...Object.keys(nightData), ...Object.keys(matchData)])].sort((a, b) => b.localeCompare(a));
  const date = dates.includes(params.get('tarih') || '') ? params.get('tarih')! : dates[0] || '';
  const rows = nightData[date] || [];
  const maps = matchData[date]?.maps || {};
  const view = params.get('gorunum') === 'maclar' ? 'maclar' : 'ortalama';
  const loading = !nightPeriods[periodId] || !matchPeriods[periodId];
  const dateIndex = dates.indexOf(date);

  function navigate(changes: Record<string, string | null>) {
    const url = new URL(window.location.href);
    Object.entries(changes).forEach(([key, value]) => value === null ? url.searchParams.delete(key) : url.searchParams.set(key, value));
    window.history.pushState(null, '', url);
  }

  useStatsRefresh({ keys: ['night_avg_periods', 'sonmac_by_date_periods'], onData: payload => {
    if (isDateKeyedPeriodPayload<Rows>(payload.night_avg_periods)) {
      setNightPayload(payload.night_avg_periods);
      setNightPeriods(payload.night_avg_periods.data || {});
    }
    if (isDateKeyedPeriodPayload<NightMatches>(payload.sonmac_by_date_periods)) {
      setMatchPayload(payload.sonmac_by_date_periods);
      setMatchPeriods(payload.sonmac_by_date_periods.data || {});
    }
    setSnapshot(Boolean(payload.backendUnavailable));
  } });

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    setLoadError(false);
    Promise.all([
      loadDateKeyedPeriodSelection({ dataset: 'night_avg', payload: nightPayload, periodId, loadedData: nightPeriods }),
      loadDateKeyedPeriodSelection({ dataset: 'sonmac_by_date', payload: matchPayload, periodId, loadedData: matchPeriods }),
    ]).then(([nights, matches]) => {
      if (cancelled) return;
      setNightPeriods({ ...nights, [periodId]: nights[periodId] || {} });
      setMatchPeriods({ ...matches, [periodId]: matches[periodId] || {} });
    }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [periodId, nightPayload, matchPayload, nightPeriods, matchPeriods, loading, retry]);

  return <div className="night-center">
    <header className="night-center-heading"><div><p>MAÇ MERKEZİ</p><h1>Gece & Maçlar<span>Aynı gece. Bütün hikâye.</span></h1><p>Kim taşımış, kim yatmış? Gecenin ortalamasından haritanın detayına.</p></div><Moon size={32} strokeWidth={1.2} aria-hidden="true" /></header>
    <section className="night-controls" aria-label="Gece seçimi">
      <label>Sezon<select value={periodId} onChange={event => navigate({ sezon: event.target.value, tarih: null })}>{seasonOptions.map(option => <option key={option.id} value={option.id}>{option.label.replace('Guncel Sezon', 'Güncel Sezon').replace('Tum Zamanlar', 'Tüm Zamanlar')}</option>)}</select></label>
      <label>Oyun gecesi<select value={date} disabled={loading || !dates.length} onChange={event => navigate({ tarih: event.target.value })}>{!dates.length && <option value="">{loading ? 'Geceler yükleniyor…' : 'Kayıtlı gece yok'}</option>}{dates.map(value => <option key={value} value={value}>{formatDate(value)}</option>)}</select></label>
      <div className="night-date-step"><button type="button" aria-label="Önceki oyun gecesi" disabled={loading || dateIndex < 0 || dateIndex >= dates.length - 1} onClick={() => navigate({ tarih: dates[dateIndex + 1] })}><ChevronLeft size={18} /></button><button type="button" aria-label="Sonraki oyun gecesi" disabled={loading || dateIndex <= 0} onClick={() => navigate({ tarih: dates[dateIndex - 1] })}><ChevronRight size={18} /></button></div>
    </section>
    <div className="night-view-switch" role="group" aria-label="İstatistik görünümü"><button type="button" aria-pressed={view === 'ortalama'} onClick={() => navigate({ gorunum: 'ortalama' })}><Moon size={18} /><span>Gece Ortalaması<small>Tüm oyuncular</small></span></button><button type="button" aria-pressed={view === 'maclar'} onClick={() => navigate({ gorunum: 'maclar' })}><Crosshair size={18} /><span>Maç Detayları<small>Harita, takım ve raunt</small></span></button></div>
    <section className="night-data-panel" aria-busy={loading} aria-label={view === 'ortalama' ? 'Gece ortalaması' : 'Maç detayları'}>
      <div className="night-panel-heading"><div><h2>{loading ? 'Gece yükleniyor…' : date ? formatDate(date) : 'Henüz maç yok'}</h2><p>{Object.keys(maps).length} harita · {rows.length} oyuncu{snapshot ? ' · kayıtlı veri' : ''}{view === 'ortalama' ? ' · maç başına ortalama' : ''}</p></div><button type="button" className="night-detail-toggle" aria-pressed={detailed} onClick={() => setDetailed(!detailed)}><SlidersHorizontal size={15} />{detailed ? 'Özet istatistikler' : 'Tüm istatistikler'}</button></div>
      {loadError ? <p className="night-empty" role="alert">Geçmiş geceler yüklenemedi. <button type="button" onClick={() => setRetry(value => value + 1)}>Tekrar dene</button></p> : loading ? <p className="night-empty" role="status">Gecenin rakamları geliyor…</p> : !date ? <p className="night-empty">Bu sezonda kayıtlı gece yok. Başka bir sezon seçebilirsin.</p> : <>
        {view === 'ortalama' ? <>
          <div className="night-table-toolbar"><div className="night-analysis-switch" role="group" aria-label="Ortalama görünümü">{([{ key: 'table', label: 'Sıralama', icon: Users }, { key: 'graph', label: 'Grafik', icon: BarChart3 }, { key: 'h2h', label: 'Karşılaştırma', icon: Crosshair }] as const).map(({ key, label, icon: Icon }) => <button type="button" key={key} aria-pressed={analysis === key} onClick={() => setAnalysis(key)}><Icon size={14} />{label}</button>)}</div><span className="night-heat-legend"><i />Düşük → yüksek</span></div>
          {analysis === 'table' ? <NightStatsTable data={rows} columns={nightAvgColumns} detailed={detailed} /> : analysis === 'graph' ? <RadarGraphs data={rows} statConfig={Object.fromEntries(nightAvgColumns.map((col, index) => [col.key, { label: col.label, default: index < 5, format: col.isPercentage ? 'percent' : undefined }]))} playerFilterKey="Nr of Matches" title="Gece ortalaması · grafik" /> : <H2HClient data={rows} columns={nightAvgColumns} matchesKey="Nr of Matches" />}
          <p className="night-table-note">Δ HLTV 2 ve Δ ADR, önceki 10 kayıtlı oyun tarihindeki ortalamaya göre farkı gösterir. Başlığa tıklayarak sırala.</p>
        </> : Object.keys(maps).length ? <SonMacClient key={date} maps={maps} detailed={detailed} /> : <p className="night-empty">Bu gece için harita detayları henüz hazır değil. Gece ortalamasına bakabilirsin.</p>}
      </>}
    </section>
  </div>;
}

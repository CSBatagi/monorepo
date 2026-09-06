'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleHelp, Crown, LoaderCircle, Users, X } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import { useLivePolling } from '@/lib/useLivePolling';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import { useAttendanceDeclaration } from '@/lib/useAttendanceDeclaration';
import { summarizeLastNight, type AttendanceStatus, type NightBriefing } from '@/lib/cinematicBriefing';
import players from '../../../public/data/players.json';

type LiveRoster = { attendance: Record<string, { name?: string; status: string }>; preview?: boolean };
const choices = [
  { status: 'coming', label: 'Geliyorum', icon: Check },
  { status: 'uncertain', label: 'Belirsizim', icon: CircleHelp },
  { status: 'not_coming', label: 'Bu gece yokum', icon: X },
] as const;
const format = (n: number | null, digits = 2) => n === null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function CinematicBriefing() {
  const { user, ready } = useSession();
  const { data, loading, error, version, refetch } = useLivePolling<LiveRoster>({ url: '/api/live/attendance', enabled: !!user, initialData: { attendance: {} } });
  const declare = useAttendanceDeclaration(refetch, Boolean(data.preview));
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [night, setNight] = useState<NightBriefing | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(false);
  const storageKey = `cs-batagi-attendance-player:${user?.uid || 'guest'}`;

  useEffect(() => {
    setSelected(''); setFeedback(null);
    try { const value = localStorage.getItem(storageKey); if (players.some(player => player.steamId === value)) setSelected(value!); } catch {}
  }, [storageKey]);
  useStatsRefresh({ keys: ['night_avg_periods', 'sonmac_by_date_periods'],
    onData: payload => { setNight(summarizeLastNight(payload)); setSnapshot(Boolean(payload.backendUnavailable)); },
    onSettled: () => setStatsLoading(false),
  });

  const entries = Object.entries(data.attendance || {});
  const coming = entries.filter(([, player]) => player.status === 'coming');
  const uncertain = entries.filter(([, player]) => player.status === 'uncertain').length;
  const known = !!user && !loading && (!error || version > 0);
  const currentStatus = data.attendance?.[selected]?.status;
  const playerName = (id: string, name?: string) => name || players.find(player => player.steamId === id)?.name || 'Oyuncu';
  const selectPlayer = (id: string) => {
    setSelected(id); setFeedback(null);
    try { localStorage.setItem(storageKey, id); } catch {}
  };
  const submit = async (status: AttendanceStatus) => {
    const player = players.find(player => player.steamId === selected);
    if (!player || busy.current) return;
    busy.current = true; setSaving(true); setFeedback(null);
    try {
      await declare(player, status);
      setFeedback({ error: false, text: status === 'coming' ? `${player.name} geliyor. Bahaneleri maçtan sonra dinleriz.` : status === 'uncertain' ? `${player.name} belirsiz. Isınma turu mu, pazarlık mı?` : `${player.name} bu gece yok. Takımın bahanesi hazır.` });
    } catch {
      setFeedback({ error: true, text: 'Katılım kaydedilemedi. Bir daha dene; eski durumun duruyor.' });
    } finally { busy.current = false; setSaving(false); }
  };

  return <div className="cinema-briefing">
    <section className="cinema-brief-panel cinema-attendance" aria-labelledby="cinema-attendance-title">
      <div className="cinema-panel-heading"><h2 id="cinema-attendance-title"><Users size={16} /> Bu gece kimler var?</h2><span className={`cinema-data-status ${error ? 'is-offline' : ''}`}><i />{data.preview ? 'YEREL PROVA' : error ? 'BAĞLANTI YOK' : known ? 'CANLI' : !user && ready ? 'GİRİŞ GEREKLİ' : 'YÜKLENİYOR'}</span></div>
      <div className="cinema-roster-summary"><strong>{known ? String(coming.length).padStart(2, '0') : '—'}</strong><div><span>kişi geliyor <small> / {known ? uncertain : '—'} belirsiz</small></span><p>{known ? coming.length >= 10 ? 'Teker döndü. Artık “az kişiyiz” bahanesi yok.' : `${10 - coming.length} kişi daha, teker dönüyor.` : error ? 'Tayfadan haber alınamadı.' : 'Tayfa toplanıyor, listeyi bekliyoruz.'}</p></div></div>
      <div className="cinema-roster-meter" aria-label={known ? `${coming.length} kişi geliyor, hedef en az 10` : 'Katılım bilinmiyor'}>{Array.from({ length: 10 }, (_, i) => <span key={i} className={known && i < coming.length ? 'is-filled' : ''} />)}</div>
      <div className="cinema-roster-names">{known && coming.length ? coming.slice(0, 6).map(([id, row]) => <span key={id}>{playerName(id, row.name)}</span>) : <span>{known ? 'İlk gelen ol. Kaptanlık sözü vermiyoruz.' : 'Gelenler burada görünecek.'}</span>}{coming.length > 6 && <Link prefetch={false} href="/attendance">+{coming.length - 6} kişi</Link>}</div>
      {data.preview && <p className="cinema-preview-note">Örnek katılım · seçimlerin sadece bu yerel provada değişir.</p>}
      {error && <button className="cinema-retry" onClick={() => void refetch()}>Katılımı yeniden yükle ↻</button>}
      {user ? <form className="cinema-attendance-form" onSubmit={event => event.preventDefault()}>
        <label htmlFor="cinema-player">Sen hangi bahaneyle geliyorsun?</label>
        <select id="cinema-player" value={selected} disabled={saving} onChange={event => selectPlayer(event.target.value)}><option value="">Önce adını seç</option>{players.map(player => <option value={player.steamId} key={player.steamId}>{player.name}</option>)}</select>
        <div className="cinema-attendance-choices">{choices.map(({ status, label, icon: Icon }) => <button key={status} type="button" data-status={status} aria-pressed={currentStatus === status} disabled={!selected || saving || loading || !!error} onClick={() => void submit(status)}><Icon size={14} />{label}</button>)}</div>
        <div className={`cinema-save-feedback ${feedback?.error ? 'is-error' : ''}`} role="status">{saving ? <><LoaderCircle size={13} className="cinema-saving" /> Katılım yazılıyor…</> : feedback?.text || (selected ? `${playerName(selected)} adına seçim yapıyorsun.` : 'Adını seç, durumunu yaz. Yoklama burada bitsin.')}</div>
      </form> : <Link prefetch={false} className="cinema-sign-in-attendance" href="/login">Giriş yap, “ben varım” de <ArrowUpRight size={16} /></Link>}
      <Link prefetch={false} className="cinema-panel-link" href="/attendance">Kim geliyor, kim yan çiziyor? <ArrowUpRight size={14} /></Link>
    </section>

    <section className="cinema-brief-panel cinema-last-night" aria-labelledby="cinema-night-title">
      <div className="cinema-panel-heading"><h2 id="cinema-night-title"><Crown size={16} /> Son gece kim taşımış?</h2>{night && <time dateTime={night.date}>{new Date(`${night.date}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time>}</div>
      {night ? <>
        <div className="cinema-night-meta"><span>SON OYNANAN GECE</span><span>{night.maps.length} harita{night.playerCount > 0 ? ` · ${night.playerCount} oyuncu` : ''}{snapshot ? ' · kayıtlı veri' : ''}</span></div>
        {night.leaders.length ? <div className="cinema-night-leaders"><div className="cinema-leader-labels"><span>HLTV 2 SIRALAMASI</span><span>HLTV 2</span><span>ADR</span><span>K/D</span></div>{night.leaders.map((player, i) => <div className="cinema-leader" key={player.steamId || player.name}><span><small>0{i + 1}</small><b>{player.name}</b>{i === 0 && <Crown size={13} />}</span><strong>{format(player.rating)}</strong><span>{format(player.adr, 1)}</span><span>{format(player.kd)}</span></div>)}</div> : <p className="cinema-empty">Bu gecenin oyuncu ortalamaları henüz hazır değil.</p>}
        <div className="cinema-night-maps">{night.maps.slice(0, 3).map(map => <div key={map.name}><span>{map.name}</span><span title={map.team1}>{map.team1}</span><strong>{map.score1 ?? '—'} <i>:</i> {map.score2 ?? '—'}</strong><span title={map.team2}>{map.team2}</span></div>)}</div>
        <p className="cinema-night-quip">“Ben kötü oynamadım” diyenleri rakamlara alalım.</p>
      </> : <div className="cinema-empty">{statsLoading ? 'Skor tabelası geliyor. Bahaneleri hazırlayın.' : 'Bu sezonun gece özeti henüz yok. Arşivdeki geceler duruyor.'}</div>}
      <div className="cinema-panel-bottom"><Link prefetch={false} href="/gece-ortalama">Gece ortalamaları <ArrowUpRight size={14} /></Link><Link prefetch={false} href="/sonmac">Maç detayları <ArrowUpRight size={14} /></Link></div>
    </section>
  </div>;
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleHelp, LoaderCircle, Users, X } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import { useLivePolling } from '@/lib/useLivePolling';
import LastNightCard from '../LastNightCard';
import { useAttendanceDeclaration } from '@/lib/useAttendanceDeclaration';
import { type AttendanceStatus } from '@/lib/cinematicBriefing';
import players from '../../../public/data/players.json';

type LiveRoster = { attendance: Record<string, { name?: string; status: string }>; preview?: boolean };
const choices = [
  { status: 'coming', label: 'Geliyorum', icon: Check },
  { status: 'uncertain', label: 'Belirsizim', icon: CircleHelp },
  { status: 'not_coming', label: 'Bu gece yokum', icon: X },
] as const;

export default function CinematicBriefing() {
  const { user, ready } = useSession();
  const { data, loading, error, version, refetch } = useLivePolling<LiveRoster>({ url: '/api/live/attendance', enabled: !!user, initialData: { attendance: {} } });
  const declare = useAttendanceDeclaration(refetch, Boolean(data.preview));
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const storageKey = `cs-batagi-attendance-player:${user?.uid || 'guest'}`;

  useEffect(() => {
    setSelected(''); setFeedback(null);
    try { const value = localStorage.getItem(storageKey); if (players.some(player => player.steamId === value)) setSelected(value!); } catch {}
  }, [storageKey]);


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

    <LastNightCard />
  </div>;
}

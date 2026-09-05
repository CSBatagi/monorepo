"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, BarChart3, Check, ClipboardList, Coins, Crosshair, Crown, Film, Flag, ListOrdered, Moon, Shield, Star, Swords, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { useLivePolling } from "@/lib/useLivePolling";

const competitions = [
  { href: '/superliga', name: 'Superliga', tag: 'LİG TABLOSU', description: 'Puanlar, sıralama ve sezonun rekabeti.', icon: Shield, className: 'league' },
  { href: '/token-wars', name: 'Token Wars', tag: 'TOKEN MÜCADELESİ', description: 'Token dengelerini ve kaptanları takip et.', icon: Coins, className: 'tokens' },
  { href: '/batak-allstars', name: 'Batak All-Stars', tag: 'ALL-STARS', description: 'Lig puanları ve Süper Kupa eşleşmeleri.', icon: Star, className: 'allstars' },
];
const analysis = [
  { href: '/season-avg', label: 'Sezon Ortalaması', sub: 'Sezonun genel performansı', icon: BarChart3 },
  { href: '/last10', label: 'Son 10 Maç', sub: 'Güncel form durumu', icon: ListOrdered },
  { href: '/gece-ortalama', label: 'Gece Ortalaması', sub: 'Maç gecelerini karşılaştır', icon: Moon },
  { href: '/duello', label: 'Düello', sub: 'Oyuncuları karşı karşıya getir', icon: Target },
  { href: '/performance', label: 'Performans Grafikleri', sub: 'Zaman içindeki gelişim', icon: TrendingUp },
  { href: '/performans-odulleri', label: 'Performans Ödülleri', sub: 'Öne çıkan gelişimler', icon: Trophy },
];

export default function ClubHome() {
  const { user } = useSession();
  const { data, loading, error } = useLivePolling<{ attendance: Record<string, { status: string }> }>({
    url: '/api/live/attendance', enabled: !!user, initialData: { attendance: {} },
  });
  const statuses = Object.values(data.attendance);
  const coming = statuses.filter(player => player.status === 'coming').length;
  const uncertain = statuses.filter(player => player.status === 'uncertain').length;
  const available = !!user && !loading && !error;
  const value = (number: number) => available ? number : '—';
  return <div className="club-home">
    <div className="club-page-heading"><div><p className="club-eyebrow">CS BATAĞI / KULÜP MERKEZİ</p><h1>İyi oyun. <span>İyi ekip.</span></h1><p>Bu gecenin kadrosu, son maçlar ve sezonun hikâyesi.</p></div><Link prefetch={false} className="club-text-link" href="/sonmac">Son maça bak <ArrowUpRight size={17} /></Link></div>
    <section className="club-night-grid" aria-label="Maç gecesi hazırlığı">
      <div className="club-night-card">
        <div className="club-card-top"><span className="club-eyebrow">MAÇ GECESİ</span><span className="club-label"><Swords size={14} /> 5 vs 5</span></div>
        <h2>Bu gece <br />kimler geliyor?</h2>
        <p>Kadroyu tamamla. Takımları kur.<br />Gerisi sunucuda.</p>
        <div className="club-night-actions"><Link prefetch={false} href="/attendance" className="club-primary-button">Katılımını bildir <ArrowUpRight size={19} /></Link><Link prefetch={false} href="/team-picker" className="club-secondary-button">Takımları seç <ArrowRight size={17} /></Link></div>
        <div className="club-night-bottom"><Crosshair size={17} /><span>COUNTER-STRIKE 2</span><span>TAKIM OYUNU. BATAK USULÜ.</span></div>
      </div>
      <div className="club-attendance-card">
        <div className="club-card-top"><h2><ClipboardList size={18} /> Katılım özeti</h2><span className={`club-live-label ${available ? '' : 'is-unavailable'}`}><i />{error ? 'Bağlantı kesildi' : available ? 'Canlı' : 'Yükleniyor'}</span></div>
        <div className="club-attendance-number"><strong>{value(coming)}</strong><span>/ 10 oyuncu<br /><b>{available && coming >= 10 ? 'Teker döndü!' : 'Maç için hazır'}</b></span></div>
        <div className="club-roster-slots" aria-label={available ? `${coming} oyuncu geliyor, hedef 10` : 'Katılım yükleniyor'}>{Array.from({ length: 10 }, (_, i) => <span className={available && i < coming ? 'filled' : ''} key={i}>{available && i < coming ? <Check size={15} /> : <Users size={14} />}</span>)}</div>
        <div className="club-attendance-stats"><span><i className="club-dot-green" />Geliyor <b>{value(coming)}</b></span><span><i className="club-dot-amber" />Belirsiz <b>{value(uncertain)}</b></span></div>
        <Link prefetch={false} href="/attendance" className="club-card-bottom-link">{error ? 'Katılımı aç ve tekrar dene' : 'Tüm katılımı görüntüle'}<ArrowRight size={17} /></Link>
      </div>
    </section>
    <section className="club-match-strip" aria-label="Maç merkezi">
      {[{ href: '/sonmac', label: 'Son maçın detayları', icon: Crosshair }, { href: '/mac-sonuclari', label: 'Maç sonuçları', icon: Flag }, { href: '/mac-videolari', label: 'Maç tekrarları', icon: Film }].map(({ href, label, icon: Icon }) => <Link prefetch={false} href={href} key={href}><Icon size={20} /><span>{label}</span><ArrowUpRight size={16} /></Link>)}
    </section>
    <section aria-labelledby="club-competitions-title"><div className="club-section-heading"><h2 id="club-competitions-title">Rekabet sahası</h2><Link prefetch={false} href="/batak-domination">Domination haritası <ArrowUpRight size={15} /></Link></div>
      <div className="club-competition-grid">{competitions.map(({ href, name, tag, description, icon: Icon, className }) => <Link prefetch={false} href={href} className={`club-competition-card ${className}`} key={href}><div className="club-card-top"><span className="club-competition-icon"><Icon size={27} strokeWidth={1.5} /></span><ArrowUpRight size={20} /></div><p className="club-eyebrow">{tag}</p><h3>{name}</h3><p>{description}</p><span className="club-competition-cta">Tabloyu görüntüle <ArrowRight size={16} /></span></Link>)}</div>
    </section>
    <section className="club-analysis-section" aria-labelledby="club-analysis-title"><div><p className="club-eyebrow">SAYILARIN ARKASINDA</p><h2 id="club-analysis-title">Oyununu<br />daha iyi tanı.</h2><p>Formunu takip et, ekibinle karşılaştır.<br />Her maçın anlatacak bir şeyi var.</p><Link prefetch={false} href="/oyuncular" className="club-secondary-button"><Users size={18} /> Oyuncuları keşfet <ArrowUpRight size={16} /></Link><Link prefetch={false} href="/gecenin-mvpsi" className="club-mvp-link"><Crown size={18} /> Gecenin MVP’sini seç <ArrowRight size={15} /></Link></div>
      <div className="club-analysis-links">{analysis.map(({ href, label, sub, icon: Icon }) => <Link prefetch={false} href={href} key={href}><span className="club-analysis-icon"><Icon size={20} /></span><span><strong>{label}</strong><small>{sub}</small></span><ArrowUpRight size={16} /></Link>)}</div>
    </section>
  </div>;
}

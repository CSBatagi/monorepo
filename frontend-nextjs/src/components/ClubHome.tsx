"use client";

import Link from "next/link";
import ClubQuotes from "./ClubQuotes";
import { ArrowRight, ArrowUpRight, BarChart3, Check, ClipboardList, Coins, Crosshair, Crown, Film, Flag, ListOrdered, Moon, Shield, Star, Swords, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { useLivePolling } from "@/lib/useLivePolling";

const competitions = [
  { href: '/superliga', name: 'Superliga', tag: 'LİG TABLOSU', description: 'Kim tepede, kim yine takıma suç atıyor?', icon: Shield, className: 'league' },
  { href: '/token-wars', name: 'Token Wars', tag: 'TOKEN MÜCADELESİ', description: 'Token hesabı burada. Dostluk başka masada.', icon: Coins, className: 'tokens' },
  { href: '/batak-allstars', name: 'Batak All-Stars', tag: 'ALL-STARS', description: 'Yıldız çok. Kupa bir tane.', icon: Star, className: 'allstars' },
];
const analysis = [
  { href: '/season-avg', label: 'Sezon Ortalaması', sub: 'Bir maçla övünmek yok', icon: BarChart3 },
  { href: '/last10', label: 'Son 10 Maç', sub: 'Form mu, iki maçlık gaz mı?', icon: ListOrdered },
  { href: '/gece-ortalama', label: 'Gece Ortalaması', sub: 'Hangi gece kimin eli tutmuş?', icon: Moon },
  { href: '/duello', label: 'Düello', sub: 'Çok konuşanı rakamla sustur', icon: Target },
  { href: '/performance', label: 'Performans Grafikleri', sub: 'Aim gelmiş mi, hâlâ yolda mı?', icon: TrendingUp },
  { href: '/performans-odulleri', label: 'Performans Ödülleri', sub: 'Sonunda eli alışanlar', icon: Trophy },
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
    <div className="club-page-heading"><ClubQuotes /><Link prefetch={false} className="club-text-link" href="/sonmac">Son maça bak <ArrowUpRight size={17} /></Link></div>
    <section className="club-night-grid" aria-label="Maç gecesi hazırlığı">
      <div className="club-night-card">
        <div className="club-night-art" aria-hidden="true" />
        <div className="club-card-top"><span className="club-eyebrow">MAÇ GECESİ</span><span className="club-label"><Swords size={14} /> Özel maç</span></div>
        <h2>Beyler, akşama <br />kimler geliyor?</h2>
        <p>Gelen gelsin.<br />Kimin kimi taşıdığını sonra tartışırız.</p>
        <div className="club-night-actions"><Link prefetch={false} href="/attendance" className="club-primary-button">Geliyor musun, yaz <ArrowUpRight size={19} /></Link><Link prefetch={false} href="/team-picker" className="club-secondary-button">Takımları seç <ArrowRight size={17} /></Link></div>
        <div className="club-night-bottom"><Crosshair size={17} /><span>COUNTER-STRIKE 2</span><span>DOSTLUK MAÇ BAŞLAYANA KADAR.</span></div>
      </div>
      <div className="club-attendance-card">
        <div className="club-card-top"><h2><ClipboardList size={18} /> Katılım özeti</h2><span className={`club-live-label ${available ? '' : 'is-unavailable'}`}><i />{error ? 'Bağlantı kesildi' : available ? 'Canlı' : 'Yükleniyor'}</span></div>
        <div className="club-attendance-number"><strong>{value(coming)}</strong><span>oyuncu geliyor<br /><b>{available ? (coming >= 10 ? 'Teker döndü!' : `Tekerin dönmesine ${10 - coming} kişi kaldı`) : 'Katılım bekleniyor'}</b></span></div>
        <p className="text-xs text-gray-500 mb-2">Tekerin dönmesi için en az 10 kişi lazım. Fazlasına da yer var!</p>
        <div className="club-roster-slots" aria-label={available ? `${coming} oyuncu geliyor, teker dönme eşiği 10` : 'Katılım yükleniyor'}>{Array.from({ length: 10 }, (_, i) => <span className={available && i < coming ? 'filled' : ''} key={i}>{available && i < coming ? <Check size={15} /> : <Users size={14} />}</span>)}</div>
        <div className="club-attendance-stats"><span><i className="club-dot-green" />Geliyor <b>{value(coming)}</b></span><span><i className="club-dot-amber" />Belirsiz <b>{value(uncertain)}</b></span></div>
        <Link prefetch={false} href="/attendance" className="club-card-bottom-link">{error ? 'Katılımı aç ve tekrar dene' : 'Kim geliyor, kim yan çiziyor?'}<ArrowRight size={17} /></Link>
      </div>
    </section>
    <section className="club-match-strip" aria-label="Maç merkezi">
      {[{ href: '/sonmac', label: 'Son maçın detayları', icon: Crosshair }, { href: '/mac-sonuclari', label: 'Maç sonuçları', icon: Flag }, { href: '/mac-videolari', label: 'Maç tekrarları', icon: Film }].map(({ href, label, icon: Icon }) => <Link prefetch={false} href={href} key={href}><Icon size={20} /><span>{label}</span><ArrowUpRight size={16} /></Link>)}
    </section>
    <section className="club-competitions-section" aria-labelledby="club-competitions-title"><div className="club-section-heading"><h2 id="club-competitions-title">Hesaplaşma vakti</h2><Link prefetch={false} href="/batak-domination">Domination haritası <ArrowUpRight size={15} /></Link></div>
      <div className="club-competition-grid">{competitions.map(({ href, name, tag, description, icon: Icon, className }) => <Link prefetch={false} href={href} className={`club-competition-card ${className}`} key={href}><div className="club-competition-art" aria-hidden="true"><span className="club-emblem-orbit" /><span className="club-emblem"><Icon size={72} strokeWidth={1.2} /></span><span className="club-art-caption">CS BATAĞI / {tag}</span><ArrowUpRight size={20} /></div><p className="club-eyebrow">{tag}</p><h3>{name}</h3><p>{description}</p><span className="club-competition-cta">Tabloyu görüntüle <ArrowRight size={16} /></span></Link>)}</div>
    </section>
    <section className="club-analysis-section" aria-labelledby="club-analysis-title"><div><p className="club-eyebrow">SKOR TABELASI YALAN SÖYLEMEZ</p><h2 id="club-analysis-title">Kim taşımış,<br />kim yatmış?</h2><p>“Ben kötü oynamadım” diyenleri alalım.<br />Rakamlar burada, bahaneler WhatsApp’ta.</p><Link prefetch={false} href="/oyuncular" className="club-secondary-button"><Users size={18} /> Tayfaya bak <ArrowUpRight size={16} /></Link><Link prefetch={false} href="/gecenin-mvpsi" className="club-mvp-link"><Crown size={18} /> Gecenin MVP’sini seç <ArrowRight size={15} /></Link></div>
      <div className="club-analysis-links">{analysis.map(({ href, label, sub, icon: Icon }) => <Link prefetch={false} href={href} key={href}><span className="club-analysis-icon"><Icon size={20} /></span><span><strong>{label}</strong><small>{sub}</small></span><ArrowUpRight size={16} /></Link>)}</div>
    </section>
  </div>;
}

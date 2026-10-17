"use client";

import Link from "next/link";
import LastNightCard from "./LastNightCard";
import ClubQuotes from "./ClubQuotes";
import { ArrowRight, ArrowUpRight, BarChart3, Check, ClipboardList, Crosshair, Crown, Film, Flag, Globe2, Headphones, ListOrdered, Swords, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { useLivePolling } from "@/lib/useLivePolling";

const analysis = [
  { href: '/season-avg', label: 'Sezon Ortalaması', sub: 'Bir maçla övünmek yok', icon: BarChart3 },
  { href: '/last10', label: 'Son 10 Maç', sub: 'Form mu, iki maçlık gaz mı?', icon: ListOrdered },
  { href: '/duello', label: 'Sezon Düelloları', sub: 'Çok konuşanı rakamla sustur', icon: Target },
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
    <Link prefetch={false} href="/teamspeak" className="club-voice-shortcut"><span className="club-voice-icon"><Headphones size={21} /></span><span><strong>Sesliye gel</strong><small>TeamSpeak bağlantısı ve kurulum</small></span><span className="club-voice-cta">TeamSpeak’i aç <ArrowUpRight size={17} /></span></Link>
    <LastNightCard />
    <div className="club-home-quick-links">
      <Link prefetch={false} href="/mundial" className="club-mundial-shortcut"><Globe2 size={34} strokeWidth={1.3} /><span><small>AKTİF SEZON</small><strong>Batak Mundial</strong><span>Gruplar, eşleşmeler ve kupa yolu</span></span><ArrowUpRight size={20} /></Link>
      <nav className="club-replay-shortcuts" aria-label="Maç arşivi">{[{ href: '/mac-sonuclari', label: 'Maç sonuçları', icon: Flag }, { href: '/mac-videolari', label: 'Maç tekrarları', icon: Film }].map(({ href, label, icon: Icon }) => <Link prefetch={false} href={href} key={href}><Icon size={19} /><span>{label}</span><ArrowUpRight size={16} /></Link>)}</nav>
    </div>
    <section className="club-analysis-section" aria-labelledby="club-analysis-title"><div><p className="club-eyebrow">SKOR TABELASI YALAN SÖYLEMEZ</p><h2 id="club-analysis-title">Kim taşımış,<br />kim yatmış?</h2><p>“Ben kötü oynamadım” diyenleri alalım.<br />Rakamlar burada, bahaneler WhatsApp’ta.</p><Link prefetch={false} href="/oyuncular" className="club-secondary-button"><Users size={18} /> Tayfaya bak <ArrowUpRight size={16} /></Link><Link prefetch={false} href="/gecenin-mvpsi" className="club-mvp-link"><Crown size={18} /> Gecenin MVP’sini seç <ArrowRight size={15} /></Link></div>
      <div className="club-analysis-links">{analysis.map(({ href, label, sub, icon: Icon }) => <Link prefetch={false} href={href} key={href}><span className="club-analysis-icon"><Icon size={20} /></span><span><strong>{label}</strong><small>{sub}</small></span><ArrowUpRight size={16} /></Link>)}</div>
    </section>
  </div>;
}

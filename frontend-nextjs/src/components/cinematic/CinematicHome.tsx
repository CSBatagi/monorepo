'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUpRight, Crosshair, MoveUpRight, Shield, Swords, Trophy } from 'lucide-react';
import { navigation } from '../ClubShell';
import CinematicBriefing from './CinematicBriefing';
import CinematicQuote from './CinematicQuote';

export default function CinematicHome() {
  return <div className="cinema-home">
    <section className="cinema-chapter cinema-hero" id="kulup" data-cinema-chapter="0" aria-labelledby="cinema-title">
      <div className="cinema-hero-stage">
        <div className="cinema-hero-copy">
          <p className="cinema-kicker"><span /> CS BATAĞI / COUNTER-STRIKE 2</p>
          <h1 id="cinema-title">Beyler, akşama<br /><span>kimler geliyor?</span></h1>
          <CinematicQuote />
        </div>
        <div className="cinema-scene-window" aria-hidden="true">
          <div className="cinema-scene-map"><span>DE_DUST II</span><strong>A BÖLGESİ</strong></div>
          <span className="cinema-scene-serial">RAUND <b>01</b></span>
          <span className="cinema-scene-corner cinema-scene-corner-start" />
          <span className="cinema-scene-corner cinema-scene-corner-end" />
          <div className="cinema-team-labels"><span>CT <i /> SAVUN</span><span>T <i /> HÜCUM</span></div>
        </div>
        <div className="cinema-actions cinema-hero-actions">
          <a href="#cinema-attendance-title" className="cinema-button">Katılım bildir <ArrowUpRight size={20} /></a>
          <Link prefetch={false} href="/team-picker" className="cinema-text-button"><Swords size={16} /> Takımları seç</Link>
        </div>
        <div className="cinema-chapter-bottom"><a href="#cinema-attendance-title" className="cinema-scroll"><span className="cinema-scroll-line" /> TAYFA TOPLANIYOR <ArrowDown size={14} /></a><span>AYNI OYUN. BİZİM HİKÂYEMİZ.</span></div>
      </div>
      <div className="cinema-match-night">
        <div className="cinema-match-night-intro"><p className="cinema-kicker"><span /> LOBİ AÇIK</p><p>Beyler, akşama kimler geliyor?</p><a href="#rekabet" aria-label="Rekabet bölümüne geç">01 / 04 <ArrowDown size={15} /></a></div>
        <CinematicBriefing />
      </div>
    </section>

    <section className="cinema-chapter cinema-rivalry" id="rekabet" data-cinema-chapter="1" aria-labelledby="rivalry-title">
      <div className="cinema-section-copy"><p className="cinema-kicker">02 / HESAPLAŞMA VAKTİ</p><h2 id="rivalry-title">Dostluk maç<br /><span>başlayana kadar.</span></h2><p className="cinema-lede">Kim tepede, kim yine takıma suç atıyor?<br />Tablo burada. İtirazlar maçtan sonra.</p></div>
      <div className="cinema-competitions">
        <Link prefetch={false} href="/superliga" className="cinema-competition"><div className="cinema-card-top"><span>01 / LİG</span><ArrowUpRight size={22} /></div><Shield className="cinema-emblem" strokeWidth={.6} /><div><h3>Superliga</h3><p>Zirve güzel. Orada kalmak biraz mesele.</p></div><span className="cinema-card-cta">TABLOYA BAK <MoveUpRight size={15} /></span></Link>
        <Link prefetch={false} href="/token-wars" className="cinema-competition"><div className="cinema-card-top"><span>02 / MÜCADELE</span><ArrowUpRight size={22} /></div><Crosshair className="cinema-emblem" strokeWidth={.6} /><div><h3>Token Wars</h3><p>Token hesabı burada. Dostluk başka masada.</p></div><span className="cinema-card-cta">HESABI GÖR <MoveUpRight size={15} /></span></Link>
        <Link prefetch={false} href="/batak-allstars" className="cinema-competition"><div className="cinema-card-top"><span>03 / ZİRVE</span><ArrowUpRight size={22} /></div><Trophy className="cinema-emblem" strokeWidth={.6} /><div><h3>All-Stars</h3><p>Yıldız çok. Kupa bir tane.</p></div><span className="cinema-card-cta">YILDIZLARI GÖR <MoveUpRight size={15} /></span></Link>
      </div>
      <div className="cinema-inline-links"><Link prefetch={false} href="/batak-domination">Batak Domination <ArrowUpRight size={15} /></Link><Link prefetch={false} href="/gecenin-mvpsi">Gecenin MVP’si <ArrowUpRight size={15} /></Link></div>
    </section>

    <section className="cinema-chapter cinema-aftermath" id="mac-merkezi" data-cinema-chapter="2" aria-labelledby="aftermath-title">
      <div className="cinema-section-copy"><p className="cinema-kicker">03 / MAÇ MERKEZİ</p><h2 id="aftermath-title">Maç biter.<br /><span>Bahanesi bitmez.</span></h2><p className="cinema-lede">“Orada olduğumu nasıl biliyor?”<br />Tekrarını açalım, birlikte öğrenelim.</p></div>
      <div className="cinema-match-links">{[
        { href: '/sonmac', number: '01', title: 'Son maç', desc: 'Kim vurmuş, kim sadece info vermiş?' },
        { href: '/mac-sonuclari', number: '02', title: 'Maç arşivi', desc: 'Unutmak istediğin skor da burada.' },
        { href: '/mac-videolari', number: '03', title: 'Tekrar izle', desc: 'Lag mıydı, aim miydi? Kayıtlara bakalım.' },
      ].map(link => <Link prefetch={false} href={link.href} key={link.href}><span className="cinema-row-number">{link.number}</span><div><h3>{link.title}</h3><p>{link.desc}</p></div><ArrowUpRight size={28} strokeWidth={1} /></Link>)}</div>
      <span className="cinema-watermark" aria-hidden="true">GG.</span>
    </section>

    <section className="cinema-chapter cinema-legacy" id="istatistik" data-cinema-chapter="3" aria-labelledby="legacy-title">
      <div className="cinema-section-copy"><p className="cinema-kicker">04 / SKOR TABELASI YALAN SÖYLEMEZ</p><h2 id="legacy-title">Kim taşımış,<br /><span>kim yatmış?</span></h2><p className="cinema-lede">Rakamlar burada, bahaneler WhatsApp’ta.<br />Bir maçla övünmek yok; sezonun tamamına bakalım.</p></div>
      <div className="cinema-stats-links">{navigation[3].links.map(({ href, label, icon: Icon }, i) => <Link prefetch={false} href={href} key={href}><span className="cinema-stat-index">0{i + 1}</span><Icon size={20} strokeWidth={1.3} /><span>{label}</span><ArrowUpRight size={18} /></Link>)}</div>
      <div className="cinema-endnote"><span>MAÇ BİTER, BAHANESİ BİTMEZ.</span><a href="#kulup">Başa dön <ArrowUpRight size={16} /></a></div>
    </section>
  </div>;
}

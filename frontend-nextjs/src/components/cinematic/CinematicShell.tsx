'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUpRight, ChevronDown, Layers3, Menu, Pause, Play, X } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useSession } from '@/contexts/SessionContext';
import NotificationBell from '../NotificationBell';
import { navigation } from '../ClubShell';
import CinematicScene from './CinematicScene';
import { chapters } from './chapters';
import { type SceneQuality } from './camera-path';

export default function CinematicShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDesign } = useTheme();
  const { user, ready, logout } = useSession();
  const [motion, setMotion] = useState(false);
  const [quality, setQuality] = useState<SceneQuality>('auto');
  const [active, setActive] = useState(0);
  const progress = useRef(0);
  const menu = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousPath = useRef(pathname);
  const home = pathname === '/';
  const groupIndex = navigation.findIndex(group => group.links.some(link => link.href === pathname));
  const group = navigation[Math.max(0, groupIndex)];
  const currentLabel = group.links.find(link => link.href === pathname)?.label || (pathname === '/login' ? 'Giriş yap' : 'Hesabım');

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      let enabled = true;
      try { enabled = localStorage.getItem('cs-batagi-cinema-motion') !== 'off'; } catch {}
      setMotion(!media.matches && enabled);
    };
    sync(); media.addEventListener('change', sync);
    try {
      const saved = localStorage.getItem('cs-batagi-cinema-quality');
      if (saved === 'lite' || saved === 'static') setQuality(saved);
    } catch {}
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!home) return;
    const sections = document.querySelectorAll<HTMLElement>('[data-cinema-chapter]');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        entry.target.classList.add('cinema-observed');
        entry.target.classList.toggle('is-visible', entry.isIntersecting);
      }
    }, { threshold: .12 });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [home]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!home) { progress.current = Math.max(0, groupIndex); setActive(Math.max(0, groupIndex)); return; }
      const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-cinema-chapter]'));
      let value = 0;
      for (let i = 0; i < sections.length; i++) {
        const rect = sections[i].getBoundingClientRect();
        if (rect.top <= window.innerHeight * .15) value = i + Math.max(0, Math.min(1, -rect.top / rect.height));
      }
      progress.current = Math.min(3, value);
      setActive(Math.min(3, Math.round(value)));
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update(); window.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', scroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', scroll); window.removeEventListener('resize', scroll); };
  }, [home, groupIndex]);

  // Links navigate natively: the router swaps routes as soon as the page is ready, with no staged exit.
  useEffect(() => {
    menu.current?.close();
    if (previousPath.current !== pathname) content.current?.focus({ preventScroll: true });
    previousPath.current = pathname;
  }, [pathname]);

  const toggleMotion = () => {
    const next = !motion;
    setMotion(next);
    try { localStorage.setItem('cs-batagi-cinema-motion', next ? 'on' : 'off'); } catch {}
  };

  const cycleQuality = () => {
    const next = quality === 'auto' ? 'lite' : quality === 'lite' ? 'static' : 'auto';
    setQuality(next);
    try { localStorage.setItem('cs-batagi-cinema-quality', next); } catch {}
  };
  const qualityLabel = quality === 'auto' ? 'OTOMATİK' : quality === 'lite' ? 'HAFİF' : 'SABİT';

  return <div className={`cinema-shell ${home ? 'cinema-home-shell' : 'cinema-detail-shell'}`} data-motion={motion ? 'on' : 'off'}>
    <a href="#cinema-content" className="cinema-skip">İçeriğe geç</a>
    <CinematicScene progress={progress} motion={motion} detail={!home} quality={quality} />
    <header className="cinema-header">
      <Link prefetch={false} href="/" className="cinema-brand" aria-label="CS Batağı ana sayfa"><Image src="/images/BatakLogo192.png" alt="" width={36} height={36} /><span>CS BATAĞI<small>AYNI TAYFA. AYNI BAHANELER.</small></span></Link>
      <nav className="cinema-topnav" aria-label="Bölümler">{chapters.map((chapter, i) => <Link prefetch={false} href={`/#${chapter.id}`} key={chapter.id} aria-current={active === i ? 'location' : undefined}><span>0{i + 1}</span>{chapter.label}</Link>)}</nav>
      <div className="cinema-header-actions">
        <details className="cinema-design-picker"><summary>Arayüz <ChevronDown size={12} /></summary><div><span>SİNEMATİK DENEYİM</span><button onClick={() => setDesign('modern')}>Kulüp tasarımları <ArrowUpRight size={14} /></button><button onClick={() => setDesign('classic')}>Klasik arayüz <ArrowUpRight size={14} /></button></div></details>
        {user ? <><NotificationBell /><details className="cinema-account"><summary>{(user.name || user.email || 'B').slice(0, 1).toLocaleUpperCase('tr')}</summary><div><Link prefetch={false} href="/notifications">Bildirim ayarları</Link><button onClick={() => void logout()}>Çıkış yap</button></div></details></> : ready && <Link prefetch={false} href="/login" className="cinema-login">Giriş yap <ArrowUpRight size={14} /></Link>}
        <button className="cinema-menu-button" onClick={() => menu.current?.showModal()} aria-label="Tüm sayfaları aç"><Menu size={22} /></button>
      </div>
    </header>

    <dialog ref={menu} className="cinema-menu">
      <div className="cinema-menu-heading"><span>CS BATAĞI / TÜM SAYFALAR</span><button autoFocus onClick={() => menu.current?.close()} aria-label="Menüyü kapat"><X size={26} /></button></div>
      <nav aria-label="Tüm sayfalar">{navigation.map((group, i) => <div key={group.label}><p>0{i + 1} / {group.label}</p>{group.links.map(link => <Link prefetch={false} href={link.href} key={link.href} onClick={() => menu.current?.close()} aria-current={pathname === link.href ? 'page' : undefined}>{link.label}<ArrowUpRight size={16} /></Link>)}</div>)}</nav>
      <div className="cinema-menu-designs"><button onClick={() => setDesign('modern')}>Kulüp tasarımları ↗</button><button onClick={() => setDesign('classic')}>Klasik arayüz ↗</button><a href="/models/cinematic/credits.txt" target="_blank" rel="noreferrer">3B model katkıları ↗</a></div>
    </dialog>

    <aside className="cinema-rail" aria-label="Sahne seçimi"><span className="cinema-rail-caption">AYNI TAYFA. AYNI BAHANELER.</span><nav>{chapters.map((chapter, i) => <Link prefetch={false} href={`/#${chapter.id}`} key={chapter.id} className={active === i ? 'is-active' : ''} aria-label={`${i + 1}. ${chapter.label}`} aria-current={active === i ? 'location' : undefined}><span>0{i + 1}</span><i /></Link>)}</nav><span className="cinema-rail-end">CS / 2</span></aside>

    <div id="cinema-content" className="cinema-route" key={pathname} ref={content} tabIndex={-1}>
      {!home && <div className="cinema-page-intro"><Link prefetch={false} href={`/#${chapters[Math.max(0, groupIndex)].id}`}><ArrowLeft size={15} /> Deneyime dön</Link><p className="cinema-kicker">0{Math.max(0, groupIndex) + 1} / {chapters[Math.max(0, groupIndex)].code}</p><h1>{currentLabel}</h1><nav aria-label="İlgili sayfalar">{group.links.filter(link => link.href !== '/').map(link => <Link prefetch={false} key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>{link.label}</Link>)}</nav></div>}
      {children}
    </div>

    <footer className="cinema-hud"><span><i /> {chapters[active].code}</span><div><button onClick={cycleQuality} className="cinema-quality-button" aria-label={`Sahne kalitesi: ${qualityLabel}. Değiştir`} title="Otomatik → Hafif → Sabit"><Layers3 size={12} /><span>{qualityLabel}</span></button><button onClick={toggleMotion} aria-pressed={motion} aria-label={motion ? 'Hareketi duraklat' : 'Hareketi etkinleştir'}>{motion ? <Pause size={12} /> : <Play size={12} />}<span>{motion ? 'HAREKET AÇIK' : 'HAREKET KAPALI'}</span></button><span className="cinema-hud-divider" /><Link prefetch={false} href={`/#${chapters[(active + 1) % 4].id}`} aria-label={active === 3 ? 'İlk bölüme dön' : 'Sonraki bölüm'}>0{active + 1} <span>/ 04</span><ArrowDown size={13} /></Link></div></footer>
  </div>;
}

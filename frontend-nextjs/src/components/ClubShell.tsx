"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BarChart3, ChevronRight, ClipboardList, Coins, Crosshair, Crown, Film, Flag, Home, LayoutTemplate, ListOrdered, LogOut, Map, Menu, Moon, Settings, Shield, Star, Swords, Target, TrendingUp, Trophy, Users, X } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useSession } from "@/contexts/SessionContext";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";

export const navigation = [
  { label: "KULÜP", links: [
    { href: "/", label: "Genel Bakış", icon: Home },
    { href: "/attendance", label: "Katılım", icon: ClipboardList },
    { href: "/team-picker", label: "Takım Seçme", icon: Swords },
  ] },
  { label: "REKABET", links: [
    { href: "/superliga", label: "Superliga", icon: Shield },
    { href: "/token-wars", label: "Token Wars", icon: Coins },
    { href: "/batak-allstars", label: "Batak All-Stars", icon: Star },
    { href: "/batak-domination", label: "Domination", icon: Map },
    { href: "/gecenin-mvpsi", label: "Gecenin MVP’si", icon: Crown },
  ] },
  { label: "MAÇ MERKEZİ", links: [
    { href: "/sonmac", label: "Son Maç", icon: Crosshair },
    { href: "/mac-sonuclari", label: "Maç Sonuçları", icon: Flag },
    { href: "/mac-videolari", label: "Maç Videoları", icon: Film },
  ] },
  { label: "İSTATİSTİK", links: [
    { href: "/oyuncular", label: "Oyuncular", icon: Users },
    { href: "/season-avg", label: "Sezon Ortalaması", icon: BarChart3 },
    { href: "/last10", label: "Son 10 Maç", icon: ListOrdered },
    { href: "/gece-ortalama", label: "Gece Ortalaması", icon: Moon },
    { href: "/duello", label: "Düello", icon: Target },
    { href: "/performance", label: "Performans", icon: TrendingUp },
    { href: "/performans-odulleri", label: "Performans Ödülleri", icon: Trophy },
  ] },
];

export default function ClubShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDesign, clubVersion, cycleClubVersion } = useTheme();
  const versionLabel = { original: '1/5 · Orijinal', panels: '2/5 · Görsel paneller', warm: '3/5 · Sıcak gri', graphite: '4/5 · Grafit', 'warm-graphite': '5/5 · Sıcak grafit' }[clubVersion];
  const { user, ready, logout } = useSession();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const group = navigation.find(group => group.links.some(link => link.href === pathname));
  const current = group?.links.find(link => link.href === pathname)?.label || (pathname.startsWith('/notifications') ? 'Bildirimler' : 'Kulüp');
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) { setOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open]);
  return (
    <div className="club-shell">
      <a className="club-skip" href="#club-content">İçeriğe geç</a>
      {open && <button className="club-scrim" data-pull-to-refresh-ignore onClick={() => setOpen(false)} aria-label="Menüyü kapat" tabIndex={-1} />}
      <aside id="club-navigation" data-pull-to-refresh-ignore className={`club-sidebar ${open ? 'is-open' : ''}`}>
        <Link prefetch={false} href="/" className="club-brand" aria-label="CS Batağı ana sayfa">
          <Image src="/images/BatakLogo192.png" width={42} height={42} alt="" />
          <span>CS BATAĞI<small>COUNTER-STRIKE KULÜBÜ</small></span>
        </Link>
        <nav aria-label="Ana gezinme" className="club-nav">
          {navigation.map(group => <div className="club-nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.links.map(({ href, label, icon: Icon }) => <Link prefetch={false} key={href} href={href}
              className={`club-nav-link ${pathname === href ? 'is-active' : ''}`} aria-current={pathname === href ? 'page' : undefined}>
              <Icon size={17} strokeWidth={1.7} /><span>{label}</span>{pathname === href && <span className="club-active-mark" />}
            </Link>)}
          </div>)}
        </nav>
        <div className="club-sidebar-bottom">
          <button onClick={() => setDesign('cinematic')} style={{ marginBottom: 16 }}><Film size={17} /> Sinematik deneyim <ArrowUpRight size={15} /></button>
          <button onClick={() => setDesign('classic')}><LayoutTemplate size={17} /> Klasik arayüze geç <ArrowUpRight size={15} /></button>
          <span>AYNI TAYFA. AYNI BAHANELER.</span>
        </div>
      </aside>
      <div className="club-workspace">
        <header className="club-topbar">
          <div className="club-breadcrumb">
            <button ref={menuButton} className="club-menu-button" aria-label={open ? 'Menüyü kapat' : 'Menüyü aç'} aria-expanded={open} aria-controls="club-navigation" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
            <span className="club-breadcrumb-group">{group?.label || 'KULÜP'}<ChevronRight size={14} /></span><span>{current}</span>
          </div>
          <div className="club-topbar-actions">
            <span className="club-game-tag">COUNTER-STRIKE 2</span>
            <ThemeToggle />
            {user && <NotificationBell />}
            {user ? <details className="club-account">
              <summary aria-label="Hesap menüsü"><span className="club-avatar">{(user.name || user.email || 'B').slice(0, 1).toLocaleUpperCase('tr')}</span><span className="club-account-name">{user.name?.split(' ')[0] || 'Hesabım'}</span></summary>
              <div className="club-account-menu"><p>{user.name || user.email}</p><Link prefetch={false} href="/notifications"><Settings size={16} /> Bildirim ayarları</Link><button onClick={() => void logout()}><LogOut size={16} /> Çıkış yap</button></div>
            </details> : ready && <Link prefetch={false} className="club-signin" href="/login">Giriş yap <ArrowUpRight size={15} /></Link>}
          </div>
        </header>
        <div className="club-version-toolbar"><button type="button" className="club-version-switch" onClick={cycleClubVersion} aria-label={`Tasarım ${versionLabel}. Sonraki tasarıma geç`}><LayoutTemplate size={16} /><span aria-live="polite">Tasarım {versionLabel}</span><ChevronRight size={16} /></button></div>
        <div id="club-content" tabIndex={-1} className="club-content">{children}</div>
        <footer className="club-footer"><span>CS BATAĞI <span className="club-footer-dot">/</span> Maç biter, bahanesi bitmez.</span><Link prefetch={false} href="/notifications">Bildirim tercihleri <ArrowUpRight size={13} /></Link></footer>
      </div>
    </div>
  );
}

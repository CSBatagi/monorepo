"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ClipboardList, Home, LogOut, Moon, Swords } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useSession } from "@/contexts/SessionContext";
import ThemeToggle from "../ThemeToggle";
import NotificationBell from "../NotificationBell";
import "./boomer.css";

// Only the pages a match night needs. Everything else lives in the club design.
const links = [
  { href: "/", label: "Ana sayfa", icon: Home },
  { href: "/attendance", label: "Katılım", icon: ClipboardList },
  { href: "/team-picker", label: "Takımlar", icon: Swords },
  { href: "/gece-ortalama", label: "Gece & Maçlar", icon: Moon },
];

export default function BoomerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDesign } = useTheme();
  const { user, ready, logout } = useSession();
  return (
    <div className="boomer-shell">
      <header className="boomer-topbar">
        <Link prefetch={false} href="/" className="boomer-brand" aria-label="CS Batağı ana sayfa">
          <Image src="/images/BatakLogo192.png" width={40} height={40} alt="" />
          <span>CS BATAĞI<small>Boomer Edition</small></span>
        </Link>
        <div className="boomer-actions">
          <ThemeToggle />
          {user && <NotificationBell />}
          {user ? <button className="boomer-logout" onClick={() => void logout()} aria-label="Çıkış yap"><LogOut size={18} /><span>Çıkış</span></button>
            : ready && <Link prefetch={false} className="boomer-logout" href="/login">Giriş yap</Link>}
        </div>
      </header>
      <nav className="boomer-nav" aria-label="Ana gezinme">
        {links.map(({ href, label, icon: Icon }) => <Link prefetch={false} key={href} href={href}
          className={pathname === href ? "is-active" : ""} aria-current={pathname === href ? "page" : undefined}>
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
        </Link>)}
      </nav>
      <div className="boomer-content">{children}</div>
      <footer className="boomer-footer">
        <span>Ligler, istatistikler, demolar ve gerisi kulüp tasarımında.</span>
        <button onClick={() => setDesign("modern")}>Tam siteye geç ↗</button>
      </footer>
    </div>
  );
}

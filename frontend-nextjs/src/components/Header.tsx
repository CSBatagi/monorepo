'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import ThemeToggle from '@/components/ThemeToggle';
import NotificationBell from '@/components/NotificationBell';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const navLinks = [
  { href: "/", label: "Anasayfa" },
  { href: "/attendance", label: "Katılım" },
  { href: "/team-picker", label: "Takım Seçme" },
  { href: "/batak-domination", label: "Batak Domination" },
  { href: "/batak-allstars", label: "Batak All-Stars" },
  { href: "/sonmac", label: "Son Maç" },
  { href: "/performans-odulleri", label: "Performans Ödülleri" },
  { href: "/gecenin-mvpsi", label: "Gecenin MVP'si" },
  { href: "/gece-ortalama", label: "Gece Ortalaması" },
  { href: "/last10", label: "Son 10 Ortalaması" },
  { href: "/season-avg", label: "Sezon Ortalaması" },
  { href: "/oyuncular", label: "Oyuncular" },
  { href: "/duello", label: "Düello" },
  { href: "/performance", label: "Performans Grafikleri" },
  { href: "/mac-sonuclari", label: "Maç Sonuçları" },
  { href: "/mac-videolari", label: "Maç Videoları" },
];

export default function Header() {
  const { user, loading, logout } = useAuth();
  const { isDark } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const splitIndex = Math.ceil(navLinks.length / 2);

  const handleNavWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.currentTarget.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  const handleSignInClick = () => {
    router.push('/login');
  };

  const handleSignOut = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Close menu on navigation
  useEffect(() => {
    setIsMenuOpen(false);
  }, [user]);

  return (
    <>
      <header className={`shadow-lg transition-colors duration-300 ${
        isDark 
          ? 'bg-[#0a0f1a] text-gray-100 border-b border-dark-border' 
          : 'bg-gray-800 text-white'
      }`}>
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          {/* Left: Logo and Title */}
          <div className="flex-shrink-0">
            <Link href="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <Image src="/images/BatakLogo.png" alt="CS2 Stats Hub Logo" width={40} height={40} className="rounded-full" />
              <span className={`text-xl font-bold tracking-tight ${
                isDark ? 'text-blue-400' : ''
              }`}>CS Batağı</span>
            </Link>
          </div>

          {/* Center: Desktop Navigation Links (two rows with overflow scroll) */}
          <div className="hidden md:flex flex-1 min-w-0">
            <nav className="w-full flex flex-col gap-1">
              <div
                className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-1"
                onWheel={handleNavWheel}
              >
                {navLinks.slice(0, splitIndex).map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      pathname === link.href
                        ? isDark
                          ? 'bg-dark-border text-blue-400 border border-blue-500/30'
                          : 'bg-gray-700'
                        : isDark
                          ? 'hover:bg-dark-card text-gray-300 hover:text-blue-400'
                          : 'hover:bg-gray-700'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <div
                className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-1"
                onWheel={handleNavWheel}
              >
                {navLinks.slice(splitIndex).map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      pathname === link.href
                        ? isDark
                          ? 'bg-dark-border text-blue-400 border border-blue-500/30'
                          : 'bg-gray-700'
                        : isDark
                          ? 'hover:bg-dark-card text-gray-300 hover:text-blue-400'
                          : 'hover:bg-gray-700'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </nav>
          </div>

          {/* Right: Account Controls (desktop/tablet) */}
          <div className="hidden md:flex flex-col items-end gap-2 flex-shrink-0">
            {loading ? (
              <div className="px-3 py-2 text-sm">Loading...</div>
            ) : user ? (
              <div className="flex flex-col items-end gap-2 rounded-lg px-2 py-1 bg-[#0b1220] border border-slate-700/70 shadow-inner">
                <div className="flex items-center gap-2 pb-1 border-b border-blue-900/50 text-gray-100">
                  {user.photoURL && <Image src={user.photoURL} alt={user.displayName || 'User'} width={28} height={28} className="rounded-full" />}
                  <span className="text-sm font-medium max-w-[170px] truncate">{user.displayName || user.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <NotificationBell />
                  <Link
                    href="/notifications"
                    title="Bildirim Ayarları"
                    aria-label="Bildirim Ayarları"
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-100 border border-gray-600/50'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                    }`}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3.2" />
                      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6Z" />
                    </svg>
                  </Link>
                  <button onClick={handleSignOut} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isDark 
                      ? 'bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700/40' 
                      : 'bg-red-600 hover:bg-red-700'
                  }`}>
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <button onClick={handleSignInClick} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isDark 
                    ? 'bg-blue-600/80 hover:bg-blue-500 border border-blue-500/30' 
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}>
                  Giriş Yap
                </button>
              </div>
            )}
          </div>

          {/* Mobile: Theme Toggle + Menu Button */}
          <div className="md:hidden ml-auto flex flex-1 items-center space-x-2 justify-end">
            <ThemeToggle />
            {!loading && user && <NotificationBell />}
            {loading ? (
              <div className="px-3 py-2 text-sm">...</div>
            ) : user ? (
              <div className="flex items-center space-x-2">
                {user.photoURL && <Image src={user.photoURL} alt="User" width={28} height={28} className="rounded-full" />}
              </div>
            ) : null}
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="Toggle menu" className={`p-2 rounded-md transition-colors ${
              isDark ? 'hover:bg-dark-border' : 'hover:bg-gray-700'
            }`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                {isMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu (Dropdown) */}
        {isMenuOpen && (
          <nav className={`md:hidden px-2 pt-2 pb-3 space-y-1 sm:px-3 transition-colors ${
            isDark ? 'border-t border-dark-border' : ''
          }`}>
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                  pathname === link.href
                    ? isDark
                      ? 'bg-dark-border text-blue-400 border-l-2 border-blue-500'
                      : 'bg-gray-700'
                    : isDark
                      ? 'hover:bg-dark-card text-gray-300 hover:text-blue-400'
                      : 'hover:bg-gray-700'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <hr className={`my-2 ${isDark ? 'border-dark-border' : 'border-gray-700'}`} />
            {loading ? (
              <div className="px-3 py-2 text-base font-medium">Loading...</div>
            ) : user ? (
              <div className="px-3 py-2">
                <div className="flex items-center space-x-2 mb-2">
                  {user.photoURL && <Image src={user.photoURL} alt={user.displayName || 'User'} width={32} height={32} className="rounded-full" />}
                  <span className="text-base font-medium">{user.displayName || user.email}</span>
                </div>
                <Link
                  href="/notifications/inbox"
                  onClick={() => setIsMenuOpen(false)}
                  className={`w-full text-left block px-3 py-2 rounded-md text-base font-medium transition-colors mb-2 ${
                    isDark
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                  }`}
                >
                  Bildirim Kutusu
                </Link>
                <Link
                  href="/notifications"
                  onClick={() => setIsMenuOpen(false)}
                  className={`w-full text-left block px-3 py-2 rounded-md text-base font-medium transition-colors mb-2 ${
                    isDark
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                  }`}
                >
                  Bildirim Ayarları
                </Link>
                <button onClick={() => { handleSignOut(); setIsMenuOpen(false); }} className={`w-full text-left block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                  isDark 
                    ? 'bg-red-900/60 hover:bg-red-800 text-red-200' 
                    : 'bg-red-600 hover:bg-red-700'
                }`}>
                  Sign Out
                </button>
              </div>
            ) : (
              <button onClick={() => { handleSignInClick(); setIsMenuOpen(false); }} className={`w-full text-left block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                isDark 
                  ? 'bg-blue-600/80 hover:bg-blue-500' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}>
                Giriş Yap
              </button>
            )}
          </nav>
        )}
      </header>
    </>
  );
}




'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import ThemeToggle from '@/components/ThemeToggle';
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
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          {/* Left: Logo and Title */}
          <div className="flex-shrink-0">
            <Link href="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <Image src="/images/BatakLogo.png" alt="CS2 Stats Hub Logo" width={40} height={40} className="rounded-full" />
              <span className={`text-xl font-bold tracking-tight ${
                isDark ? 'text-blue-400' : ''
              }`}>CS Batağı</span>
            </Link>
          </div>

          {/* Center: Desktop Navigation Links (two rows) */}
          <div className="hidden md:flex flex-1 justify-center">
            <nav className="flex flex-col items-center space-y-1">
              <div className="flex items-center space-x-1 flex-wrap">
                {navLinks.slice(0, Math.ceil(navLinks.length / 2)).map(link => (
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
              <div className="flex items-center space-x-1 flex-wrap">
                {navLinks.slice(Math.ceil(navLinks.length / 2)).map(link => (
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

          {/* Right: Theme Toggle + Auth Buttons (desktop) */}
          <div className="hidden md:flex items-center space-x-3 flex-shrink-0">
            <ThemeToggle />
            {loading ? (
              <div className="px-3 py-2 text-sm">Loading...</div>
            ) : user ? (
              <div className="flex items-center space-x-3">
                {user.photoURL && <Image src={user.photoURL} alt={user.displayName || 'User'} width={32} height={32} className="rounded-full" />}
                <span className="text-sm font-medium">{user.displayName || user.email}</span>
                <button onClick={handleSignOut} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isDark 
                    ? 'bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700/40' 
                    : 'bg-red-600 hover:bg-red-700'
                }`}>
                  Sign Out
                </button>
              </div>
            ) : (
              <button onClick={handleSignInClick} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                isDark 
                  ? 'bg-blue-600/80 hover:bg-blue-500 border border-blue-500/30' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}>
                Giriş Yap
              </button>
            )}
          </div>

          {/* Mobile: Theme Toggle + Menu Button */}
          <div className="md:hidden flex items-center space-x-2">
            <ThemeToggle />
            {loading ? (
              <div className="px-3 py-2 text-sm">...</div>
            ) : user ? (
              <div className="flex items-center space-x-2 mr-1">
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




'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const navLinks = [
  { href: "/", label: "Anasayfa" },
  { href: "/attendance", label: "Katılım" },
  { href: "/team-picker", label: "Takım Seçme" },
  { href: "/batak-domination", label: "Batak Domination" },
  { href: "/sonmac", label: "Son Maç" },
  { href: "/performans-odulleri", label: "Performans Ödülleri" },
  { href: "/gece-ortalama", label: "Gece Ortalaması" },
  { href: "/last10", label: "Son 10 Ortalaması" },
  { href: "/season-avg", label: "Sezon Ortalaması" },
  { href: "/duello", label: "Düello" },
  { href: "/performance", label: "Performans Grafikleri" },
  { href: "/mac-sonuclari", label: "Maç Sonuçları" }, // New link added here
];

export default function Header() {
  const { user, loading, logout } = useAuth();
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

  // Close menu on navigation (for mobile)
  useEffect(() => {
    setIsMenuOpen(false); 
  }, [user]); // Also close if auth state changes, or use router events if more fine-grained control is needed

  return (
    <>
      <header className="bg-gray-800 text-white shadow-lg">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          {/* Left: Logo and Title */}
          <div className="flex-shrink-0">
          <Link href="/" legacyBehavior>
            <a className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <Image src="/images/BatakLogo.png" alt="CS2 Stats Hub Logo" width={40} height={40} className="rounded-full" />
              <span className="text-xl font-bold tracking-tight">CS Batağı</span>
            </a>
          </Link>
          </div>

          {/* Center: Desktop Navigation Links (two rows) */}
          <div className="hidden md:flex flex-1 justify-center">
            <nav className="flex flex-col items-center space-y-1">
              <div className="flex items-center space-x-2 flex-wrap">
                {navLinks.slice(0, Math.ceil(navLinks.length / 2)).map(link => (
                  <Link key={link.href} href={link.href} legacyBehavior>
                    <a className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors whitespace-nowrap${pathname === link.href ? ' bg-gray-700' : ''}`}>
                      {link.label}
                    </a>
                  </Link>
                ))}
              </div>
              <div className="flex items-center space-x-2 flex-wrap">
                {navLinks.slice(Math.ceil(navLinks.length / 2)).map(link => (
              <Link key={link.href} href={link.href} legacyBehavior>
                    <a className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors whitespace-nowrap${pathname === link.href ? ' bg-gray-700' : ''}`}>
                      {link.label}
                    </a>
              </Link>
            ))}
              </div>
            </nav>
          </div>
            
          {/* Right: Auth Buttons (desktop) and Mobile Menu/Avatar (mobile) */}
          <div className="hidden md:flex items-center space-x-3 flex-shrink-0">
            {loading ? (
              <div className="px-3 py-2 text-sm">Loading...</div>
            ) : user ? (
              <div className="flex items-center space-x-3">
                {user.photoURL && <Image src={user.photoURL} alt={user.displayName || 'User'} width={32} height={32} className="rounded-full" />} 
                <span className="text-sm font-medium">{user.displayName || user.email}</span>
                <button onClick={handleSignOut} className="px-3 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 transition-colors">
                  Sign Out
                </button>
              </div>
            ) : (
              <button onClick={handleSignInClick} className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-700 transition-colors">
                Giriş Yap
              </button>
            )}
          </div>

          {/* Mobile Menu Button and Avatar (right-aligned) */}
          <div className="md:hidden flex items-center">
            {loading ? (
               <div className="px-3 py-2 text-sm">...</div>
            ) : user ? (
              <div className="flex items-center space-x-2 mr-2">
                  {user.photoURL && <Image src={user.photoURL} alt="User" width={28} height={28} className="rounded-full" />}
              </div>
            ) : null } 
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="Toggle menu" className="p-2 rounded-md hover:bg-gray-700">
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
          <nav className="md:hidden px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {navLinks.map(link => (
              <Link key={link.href} href={link.href} legacyBehavior>
                <a onClick={() => setIsMenuOpen(false)} className={`block px-3 py-2 rounded-md text-base font-medium hover:bg-gray-700 transition-colors${pathname === link.href ? ' bg-gray-700' : ''}`}>
                  {link.label}
                </a>
              </Link>
            ))}
            <hr className="border-gray-700 my-2"/>
            {loading ? (
              <div className="px-3 py-2 text-base font-medium">Loading...</div>
            ) : user ? (
              <div className="px-3 py-2">
                  <div className="flex items-center space-x-2 mb-2">
                      {user.photoURL && <Image src={user.photoURL} alt={user.displayName || 'User'} width={32} height={32} className="rounded-full" />}
                      <span className="text-base font-medium">{user.displayName || user.email}</span>
                  </div>
                <button onClick={() => { handleSignOut(); setIsMenuOpen(false); }} className="w-full text-left block px-3 py-2 rounded-md text-base font-medium bg-red-600 hover:bg-red-700 transition-colors">
                  Sign Out
                </button>
              </div>
            ) : (
              <button onClick={() => { handleSignInClick(); setIsMenuOpen(false); }} className="w-full text-left block px-3 py-2 rounded-md text-base font-medium bg-blue-600 hover:bg-blue-700 transition-colors">
                Giriş Yap
              </button>
            )}
          </nav>
        )}
      </header>

    </>
  );
}
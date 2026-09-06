"use client";

import React, { ReactNode } from 'react';
import Header from './Header';
import ClubShell from './ClubShell';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/ThemeContext';
import { usePathname } from 'next/navigation';

// Cinematic is an opt-in mode; classic and club must not download its scene bundle.
const CinematicShell = dynamic(() => import('./cinematic/CinematicShell'), { ssr: false });

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const pathname = usePathname();
    const { design, setDesign } = useTheme();
    const isLoginPage = pathname === '/login';

    if (design === 'cinematic') return <CinematicShell>{children}</CinematicShell>;
    if (design === 'modern' && !isLoginPage) return <ClubShell>{children}</ClubShell>;
    return (
        <>
            {!isLoginPage && <Header />}
            {children}
            <button className="interface-switch" onClick={() => setDesign(design === 'classic' ? 'modern' : 'classic')}>
                {design === 'classic' ? 'Yeni arayüze geç ↗' : 'Klasik arayüze geç ↗'}
            </button>
            <button className="interface-switch cinematic-interface-entry" onClick={() => setDesign('cinematic')}>Sinematik deneyim ↗</button>
        </>
    );
};

export default Layout; 

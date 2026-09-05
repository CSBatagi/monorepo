"use client";

import React, { ReactNode } from 'react';
import Header from './Header';
import ClubShell from './ClubShell';
import { useTheme } from '@/contexts/ThemeContext';
import { usePathname } from 'next/navigation';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const pathname = usePathname();
    const { design, setDesign } = useTheme();
    const isLoginPage = pathname === '/login';

    if (design === 'modern' && !isLoginPage) return <ClubShell>{children}</ClubShell>;
    return (
        <>
            {!isLoginPage && <Header />}
            {children}
            <button className="interface-switch" onClick={() => setDesign(design === 'classic' ? 'modern' : 'classic')}>
                {design === 'classic' ? 'Yeni arayüze geç ↗' : 'Klasik arayüze geç ↗'}
            </button>
        </>
    );
};

export default Layout; 
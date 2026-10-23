"use client";

import React, { ReactNode } from 'react';
import ClubShell from './ClubShell';
import BoomerShell from './boomer/BoomerShell';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/ThemeContext';
import { usePathname } from 'next/navigation';

// Cinematic is an opt-in mode; boomer and club must not download its scene bundle.
const CinematicShell = dynamic(() => import('./cinematic/CinematicShell'), { ssr: false });

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const pathname = usePathname();
    const { design } = useTheme();

    if (design === 'cinematic') return <CinematicShell>{children}</CinematicShell>;
    if (pathname === '/login') return <>{children}</>;
    if (design === 'boomer') return <BoomerShell>{children}</BoomerShell>;
    return <ClubShell>{children}</ClubShell>;
};

export default Layout;

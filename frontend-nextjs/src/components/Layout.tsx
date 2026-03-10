"use client";

import React, { ReactNode } from 'react';
import Header from './Header';
import { usePathname } from 'next/navigation';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const pathname = usePathname();
    const isLoginPage = pathname === '/login';

    return (
        <>
            {!isLoginPage && <Header />}
            {children}
        </>
    );
};

export default Layout; 
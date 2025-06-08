"use client";

import React, { ReactNode } from 'react';
import Header from './Header';
import EmailVerificationBanner from './EmailVerificationBanner';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    return (
        <>
            <Header />
            <EmailVerificationBanner />
            {children}
        </>
    );
};

export default Layout; 
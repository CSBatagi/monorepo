"use client";

import React, { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import NotificationForegroundHandler from "@/components/NotificationForegroundHandler";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";

/**
 * Firebase-dependent providers and components.
 *
 * This wrapper is dynamically imported (code-split) so that pages which don't
 * need Firebase (stats pages) never download the Firebase SDK (~200-400 KB).
 *
 * NOTE: AdminStatsButton was moved to Providers.tsx so it renders on ALL pages
 * (it uses session auth, not Firebase Auth).
 */
export default function FirebaseProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <EmailVerificationBanner />
      {children}
      <NotificationForegroundHandler />
    </AuthProvider>
  );
}

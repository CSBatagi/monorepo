"use client";

import React, { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import AdminStatsButton from "@/components/AdminStatsButton";
import NotificationForegroundHandler from "@/components/NotificationForegroundHandler";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";

/**
 * Firebase-dependent providers and components.
 *
 * This wrapper is dynamically imported (code-split) so that pages which don't
 * need Firebase (stats pages) never download the Firebase SDK (~200-400 KB).
 */
export default function FirebaseProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <NotificationProvider>
        <EmailVerificationBanner />
        {children}
        <AdminStatsButton />
        <NotificationForegroundHandler />
      </NotificationProvider>
    </AuthProvider>
  );
}

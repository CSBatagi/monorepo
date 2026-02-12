"use client";

import React, { ReactNode } from "react";
import Layout from "@/components/Layout";
import AuthGate from "@/components/AuthGate";
import AdminStatsButton from "@/components/AdminStatsButton";
import NotificationForegroundHandler from "@/components/NotificationForegroundHandler";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <NotificationProvider>
            <Layout>
              <main className="container mx-auto max-w-7xl p-4 md:p-8">
                {children}
              </main>
            </Layout>
            <AdminStatsButton />
            <NotificationForegroundHandler />
          </NotificationProvider>
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}

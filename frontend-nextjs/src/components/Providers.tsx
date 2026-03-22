"use client";

import React, { ReactNode } from "react";
import Layout from "@/components/Layout";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SessionProvider } from "@/contexts/SessionContext";
import AdminStatsButton from "@/components/AdminStatsButton";
import { NotificationProvider } from "@/contexts/NotificationContext";

export default function Providers({ children }: { children: ReactNode }) {
  const content = (
    <main className="container mx-auto max-w-7xl p-4 md:p-8">
      {children}
    </main>
  );

  return (
    <ThemeProvider>
      <SessionProvider>
        <NotificationProvider>
          <Layout>
            {content}
            <AdminStatsButton />
          </Layout>
        </NotificationProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

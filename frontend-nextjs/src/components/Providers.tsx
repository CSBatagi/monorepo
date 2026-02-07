"use client";

import React, { ReactNode } from "react";
import Layout from "@/components/Layout";
import AuthGate from "@/components/AuthGate";
import AdminStatsButton from "@/components/AdminStatsButton";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <Layout>
            <main className="container mx-auto max-w-7xl p-4 md:p-8">
              {children}
            </main>
          </Layout>
          <AdminStatsButton />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}

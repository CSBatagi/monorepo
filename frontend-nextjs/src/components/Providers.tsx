"use client";

import React, { ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import Layout from "@/components/Layout";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SessionProvider } from "@/contexts/SessionContext";
import AdminStatsButton from "@/components/AdminStatsButton";
import { NotificationProvider } from "@/contexts/NotificationContext";

/**
 * Code-split: FirebaseProviders (and its firebase SDK deps) are only downloaded
 * when the user visits a route that actually needs Firebase.
 */
const FirebaseProviders = dynamic(
  () => import("@/components/FirebaseProviders"),
);

/** Routes that require Firebase Auth / Realtime Database on the client. */
const FIREBASE_ROUTES = [
  // "/attendance" — migrated to PostgreSQL polling + session auth
  // "/team-picker" — migrated to PostgreSQL polling, no longer needs Firebase SDK
  "/gecenin-mvpsi",
  "/notifications",
  "/login",
  "/batak-allstars",
];

function needsFirebase(pathname: string): boolean {
  return FIREBASE_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const firebase = needsFirebase(pathname);

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
            {firebase ? (
              <FirebaseProviders>{content}</FirebaseProviders>
            ) : (
              content
            )}
            <AdminStatsButton />
          </Layout>
        </NotificationProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

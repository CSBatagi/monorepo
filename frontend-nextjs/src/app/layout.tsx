import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/styles/table-styles.css";
import Providers from "@/components/Providers";
import fs from 'fs/promises';
import path from 'path';
import { after } from 'next/server';
import { readSnapshotMetadata, writeStatsSnapshotWithStatus, persistSnapshotMetadata } from '@/lib/statsSnapshot';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CS Batağı",
  description: "CS Batagi app",
  manifest: "/manifest.json",
};

let lastKnownStatsVersion = 0;
let lastRefreshTime = 0; // epoch ms of last backend call
const REFRESH_COOLDOWN_MS = 90 * 1000; // 90 seconds — backend check is cheap (in-memory timestamp), keep short for data freshness
const REFRESH_TIMEOUT_MS = 30000; // 30s — runs post-response via after(), so longer timeout is safe; stats generation on 1 GB VM can take 10-20s
let refreshInFlight: Promise<void> | null = null;
const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
async function loadPersistedMetadata(){
  const metadata = await readSnapshotMetadata(runtimeDir);
  lastKnownStatsVersion = metadata?.statsVersion || 0;
}

async function incrementalRefresh() {
  // Cooldown: skip backend call if we checked recently
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) return;
  if (refreshInFlight) return refreshInFlight;
  lastRefreshTime = now;
  refreshInFlight = (async () => {
    const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
    const url = new URL('/stats/incremental', backendBase);
    if (lastKnownStatsVersion > 0) url.searchParams.set('lastKnownVersion', String(lastKnownStatsVersion));
    url.searchParams.set('_cb', Date.now().toString());

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), REFRESH_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { cache: 'no-store', signal: ac.signal });
      if (!res.ok) return;
      const data: any = await res.json().catch(()=>null);
      if (!data) return;
      lastKnownStatsVersion = Number(data.statsVersion || lastKnownStatsVersion || 0);
      if (data.updated) {
        const writeResult = await writeStatsSnapshotWithStatus(data, runtimeDir);
        if (writeResult.complete) {
          await persistSnapshotMetadata(runtimeDir, {
            statsVersion: Number(data.statsVersion || 0),
            serverTimestamp: typeof data.serverTimestamp === 'string' ? data.serverTimestamp : null,
          });
        } else if (!writeResult.complete) {
          console.warn('[stats-refresh] runtime snapshot preserved old files; skipping timestamp persist', {
            preservedExistingDueToEmpty: writeResult.preservedExistingDueToEmpty,
          });
        }
      }
    } catch {}
    finally {
      clearTimeout(timeout);
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// Load persisted timestamp once (module scope ensures single flight)
if (!lastKnownStatsVersion) {
  loadPersistedMetadata();
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Notification scheduler now runs in the backend process (see backend/notificationScheduler.js).

  // Run refresh AFTER the response is sent — avoids tainting ISR pages as dynamic.
  after(() => {
    void incrementalRefresh();
  });
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

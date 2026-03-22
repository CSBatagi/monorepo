import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/styles/table-styles.css";
import Providers from "@/components/Providers";
import fs from 'fs/promises';
import path from 'path';
import { after } from 'next/server';
import { writeStatsSnapshot, persistTimestamp } from '@/lib/statsSnapshot';

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

let lastServerKnownTs: string | null = null; // per server runtime
let lastRefreshTime = 0; // epoch ms of last backend call
const REFRESH_COOLDOWN_MS = 90 * 1000; // 90 seconds — backend check is cheap (in-memory timestamp), keep short for data freshness
const REFRESH_TIMEOUT_MS = 30000; // 30s — runs post-response via after(), so longer timeout is safe; stats generation on 1 GB VM can take 10-20s
let refreshInFlight: Promise<void> | null = null;
const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(), 'runtime-data');
const tsPersistPath = path.join(runtimeDir, 'last_timestamp.txt');
async function loadPersistedTs(){
  try { const raw = await fs.readFile(tsPersistPath,'utf-8'); lastServerKnownTs = raw.trim() || null; } catch {}
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
    if (lastServerKnownTs) url.searchParams.set('lastKnownTs', lastServerKnownTs);
    url.searchParams.set('_cb', Date.now().toString());

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), REFRESH_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { cache: 'no-store', signal: ac.signal });
      if (!res.ok) return;
      const data: any = await res.json().catch(()=>null);
      if (!data) return;
      if (data.serverTimestamp) {
        lastServerKnownTs = data.serverTimestamp;
        await persistTimestamp(runtimeDir, lastServerKnownTs as string);
      }
      if (data.updated) {
        await writeStatsSnapshot(data, runtimeDir);
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
if (!lastServerKnownTs) {
  // Fire and forget; layout will continue and incrementalRefresh will use null on first run
  loadPersistedTs();
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

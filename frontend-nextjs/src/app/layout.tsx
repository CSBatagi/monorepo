import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/styles/table-styles.css";
import Providers from "@/components/Providers";
import fs from 'fs/promises';
import path from 'path';
import { ensureNotificationSchedulerStarted } from "@/lib/notificationScheduler";

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
const REFRESH_COOLDOWN_MS = 60 * 1000; // 60 seconds - backend call is cheap (in-memory timestamp comparison only)
const tsPersistPath = path.join(process.cwd(), 'runtime-data', 'last_timestamp.txt');
async function loadPersistedTs(){
  try { const raw = await fs.readFile(tsPersistPath,'utf-8'); lastServerKnownTs = raw.trim() || null; } catch {}
}
async function persistTs(ts:string){
  try { await fs.mkdir(path.dirname(tsPersistPath), { recursive:true }); await fs.writeFile(tsPersistPath, ts,'utf-8'); } catch {}
}

async function incrementalRefresh() {
  // Cooldown: skip backend call if we checked recently
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) return;
  lastRefreshTime = now;

  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const url = new URL('/stats/incremental', backendBase);
  if (lastServerKnownTs) url.searchParams.set('lastKnownTs', lastServerKnownTs);
  url.searchParams.set('_cb', Date.now().toString());
  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return;
    const data: any = await res.json().catch(()=>null);
    if (!data) return;
  if (data.serverTimestamp) { lastServerKnownTs = data.serverTimestamp; await persistTs(lastServerKnownTs as string); }
    if (data.updated) {
      const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(),'runtime-data');
      await fs.mkdir(runtimeDir,{recursive:true});
      const statFiles = [
        'night_avg.json','night_avg_all.json','sonmac_by_date.json','sonmac_by_date_all.json','duello_son_mac.json','duello_sezon.json','performance_data.json','players_stats.json','players_stats_periods.json','map_stats.json','season_avg_periods.json'
      ];
      for (const base of statFiles) {
        const key = base.replace(/\.json$/, '');
        if (data[key] !== undefined) {
          try { await fs.writeFile(path.join(runtimeDir, base), JSON.stringify(data[key], null, 2),'utf-8'); } catch {}
        }
      }

    }
  } catch {}
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
  ensureNotificationSchedulerStarted();
  // Trigger incremental refresh once per request lifecycle (doesn't block rendering significantly)
  await incrementalRefresh();
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

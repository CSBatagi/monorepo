import SeasonAvgTabsClient from "@/components/SeasonAvgTabsClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = 'force-dynamic';

export default async function SeasonAvgPage() {
  // Always force fresh aggregates first (blocking) with short timeout; fallback to existing file.
  let data: any[] = [];
  let fetched: any = null;
  const aggregatesUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/stats/aggregates?_cb=${Date.now()}`;
  try {
    const ac = new AbortController();
    const timeout = setTimeout(()=>ac.abort(), 2000);
    const res = await fetch(aggregatesUrl, { cache:'no-store', signal: ac.signal });
    clearTimeout(timeout);
    if (res.ok) {
      fetched = await res.json();
      if (Array.isArray(fetched.season_avg)) data = fetched.season_avg;
    }
  } catch (e) {
    // ignore, fallback below
  }
  if (!data.length) {
    try { const r = await readJson('season_avg.json'); if (Array.isArray(r)) data = r; } catch {}
  }
  return (
    <div id="page-season_avg" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Sezon Ortalaması</h2>
      <SeasonAvgTabsClient data={data} />
    </div>
  );
}
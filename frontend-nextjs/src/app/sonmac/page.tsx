import SonMacClient from "@/components/SonMacClient";
import { readJson } from "@/lib/dataReader";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";

export const revalidate = 60; // seconds – data changes only when stats regenerate

async function tryBackend(timeoutMs = 1500) {
  const backendBase = process.env.BACKEND_INTERNAL_URL || "http://backend:3000";
  const url = `${backendBase}/stats/incremental?_cb=${Date.now()}`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    if (j && j.sonmac_by_date_all && typeof j.sonmac_by_date_all === "object") return j.sonmac_by_date_all;
    if (j && j.sonmac_by_date && typeof j.sonmac_by_date === "object") return j.sonmac_by_date;
  } catch (e) {
    console.log("[sonmac] backend fetch failed", (e as any)?.message);
  }
  return null;
}

export default async function SonMacPage() {
  const seasonStartRaw = (await readJson("season_start.json")) || {};
  const seasonStarts = normalizeSeasonStarts(
    seasonStartRaw?.season_starts,
    [seasonStartRaw?.season_start].filter(Boolean) as string[]
  );

  let allData: Record<string, any> = (await readJson("sonmac_by_date_all.json")) || {};
  if (!allData || Object.keys(allData).length === 0) {
    allData = (await readJson("sonmac_by_date.json")) || {};
  }
  if (!allData || Object.keys(allData).length === 0) {
    const regen = await tryBackend();
    if (regen) {
      allData = regen;
      console.log("[sonmac] Filled empty dataset from backend");
    }
  }
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-sonmac" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son Mac</h2>
      <SonMacClient allData={allData} dates={dates} seasonStarts={seasonStarts} />
    </div>
  );
}

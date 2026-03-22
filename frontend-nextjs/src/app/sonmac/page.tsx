import SonMacClient from "@/components/SonMacClient";
import { readJson } from "@/lib/dataReader";
import { fetchStats } from "@/lib/statsServer";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function SonMacPage() {
  const seasonStartRaw = (await readJson("season_start.json")) || {};
  const seasonStarts = normalizeSeasonStarts(
    seasonStartRaw?.season_starts,
    [seasonStartRaw?.season_start].filter(Boolean) as string[]
  );

  const stats = await fetchStats('sonmac_by_date_all', 'sonmac_by_date');
  let allData: Record<string, any> = stats.sonmac_by_date_all || {};
  if (!Object.keys(allData).length) {
    allData = stats.sonmac_by_date || {};
  }
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-sonmac" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son Mac</h2>
      <SonMacClient allData={allData} dates={dates} seasonStarts={seasonStarts} />
    </div>
  );
}

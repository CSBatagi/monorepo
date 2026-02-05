import SonMacClient from "@/components/SonMacClient";
import { readJson } from "@/lib/dataReader";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";

export const dynamic = "force-dynamic";

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
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-sonmac" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son Mac</h2>
      <SonMacClient allData={allData} dates={dates} seasonStarts={seasonStarts} />
    </div>
  );
}

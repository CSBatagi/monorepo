import PerformansOdulleriClient from "@/components/PerformansOdulleriClient";
import { readJson } from "@/lib/dataReader";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";

export const dynamic = "force-dynamic";

export default async function PerformansOdulleriPage() {
  const seasonStartRaw = (await readJson("season_start.json")) || {};
  const seasonStarts = normalizeSeasonStarts(
    seasonStartRaw?.season_starts,
    [seasonStartRaw?.season_start].filter(Boolean) as string[]
  );

  let allData: Record<string, any[]> = {};
  try {
    const all = await readJson("night_avg_all.json");
    if (all && typeof all === "object" && !Array.isArray(all)) allData = all;
  } catch {}
  if (!Object.keys(allData).length) {
    try {
      const current = await readJson("night_avg.json");
      if (current && typeof current === "object" && !Array.isArray(current)) allData = current;
    } catch {}
  }

  return (
    <div id="page-performans-odulleri" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Performans Odulleri</h2>
      <PerformansOdulleriClient allData={allData} seasonStarts={seasonStarts} />
    </div>
  );
}

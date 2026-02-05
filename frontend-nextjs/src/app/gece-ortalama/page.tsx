import NightAvgTableClient from "@/components/NightAvgTableClient";
import { readJson } from "@/lib/dataReader";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";

export const dynamic = "force-dynamic";

export default async function GeceOrtalamasiPage() {
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

  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-gece_ortalama" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gece Ortalamasi</h2>
      <NightAvgTableClient allData={allData} dates={dates} seasonStarts={seasonStarts} />
    </div>
  );
}

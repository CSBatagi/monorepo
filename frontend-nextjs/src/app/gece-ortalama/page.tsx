import NightAvgTableClient from "@/components/NightAvgTableClient";
import { readJson } from "@/lib/dataReader";
import { fetchStats } from "@/lib/statsServer";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";
import { isDateKeyedPeriodPayload, getDateKeyedPeriodData } from "@/lib/statsPeriods";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function GeceOrtalamasiPage() {
  const seasonStartRaw = (await readJson("season_start.json")) || {};
  const seasonStarts = normalizeSeasonStarts(
    seasonStartRaw?.season_starts,
    [seasonStartRaw?.season_start].filter(Boolean) as string[]
  );

  const stats = await fetchStats('night_avg_periods', 'night_avg');
  const periodPayload = isDateKeyedPeriodPayload<any[]>(stats.night_avg_periods) ? stats.night_avg_periods : null;
  let allData: Record<string, any[]> = {};
  if (periodPayload?.current_period) {
    allData = getDateKeyedPeriodData(periodPayload, periodPayload.current_period);
  }
  if (!Object.keys(allData).length && stats.night_avg && typeof stats.night_avg === "object" && !Array.isArray(stats.night_avg)) {
    allData = stats.night_avg;
  }

  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-gece_ortalama" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gece Ortalamasi</h2>
      <NightAvgTableClient allData={allData} dates={dates} seasonStarts={seasonStarts} periodPayload={periodPayload} />
    </div>
  );
}

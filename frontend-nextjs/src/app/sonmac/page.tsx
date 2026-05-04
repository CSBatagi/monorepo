import SonMacClient from "@/components/SonMacClient";
import { readJson } from "@/lib/dataReader";
import { fetchStats } from "@/lib/statsServer";
import { normalizeSeasonStarts } from "@/lib/seasonRanges";
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from "@/lib/statsPeriods";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function SonMacPage() {
  const seasonStartRaw = (await readJson("season_start.json")) || {};
  const seasonStarts = normalizeSeasonStarts(
    seasonStartRaw?.season_starts,
    [seasonStartRaw?.season_start].filter(Boolean) as string[]
  );

  const stats = await fetchStats('sonmac_by_date_periods', 'sonmac_by_date');
  const periodPayload = isDateKeyedPeriodPayload<any>(stats.sonmac_by_date_periods) ? stats.sonmac_by_date_periods : null;
  let allData: Record<string, any> = periodPayload?.current_period
    ? getDateKeyedPeriodData(periodPayload, periodPayload.current_period)
    : stats.sonmac_by_date || {};
  if (!Object.keys(allData).length) {
    allData = stats.sonmac_by_date || {};
  }
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-sonmac" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son Mac</h2>
      <SonMacClient allData={allData} dates={dates} seasonStarts={seasonStarts} periodPayload={periodPayload} />
    </div>
  );
}

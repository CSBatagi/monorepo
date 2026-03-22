import SeasonAvgTabsClient from "@/components/SeasonAvgTabsClient";
import { fetchStats } from "@/lib/statsServer";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function SeasonAvgPage() {
  const stats = await fetchStats('season_avg', 'season_avg_periods');
  let data: any[] = Array.isArray(stats.season_avg) ? stats.season_avg : [];
  let periodData: any = (stats.season_avg_periods && typeof stats.season_avg_periods === "object" && stats.season_avg_periods.data)
    ? stats.season_avg_periods
    : null;

  if (periodData?.current_period && Array.isArray(periodData?.data?.[periodData.current_period]) && !data.length) {
    data = periodData.data[periodData.current_period];
  }

  if (!periodData && data.length) {
    periodData = {
      current_period: "season_current",
      periods: [{ id: "season_current", label: "Guncel Sezon", start_date: null, end_date: null, is_current: true }],
      data: { season_current: data },
    };
  }

  return (
    <div id="page-season_avg" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Sezon Ortalamasi</h2>
      <SeasonAvgTabsClient data={data} periodData={periodData} />
    </div>
  );
}

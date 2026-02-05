import SeasonAvgTabsClient from "@/components/SeasonAvgTabsClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = "force-dynamic";

export default async function SeasonAvgPage() {
  let data: any[] = [];
  let periodData: any = null;

  const aggregatesUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/stats/aggregates?_cb=${Date.now()}`;
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(aggregatesUrl, { cache: "no-store", signal: ac.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const fetched: any = await res.json();
      if (Array.isArray(fetched?.season_avg)) data = fetched.season_avg;
      if (fetched?.season_avg_periods && typeof fetched.season_avg_periods === "object") {
        periodData = fetched.season_avg_periods;
      }
    }
  } catch (_) {
    // fallback to files below
  }

  if (!periodData) {
    try {
      const filePayload = await readJson("season_avg_periods.json");
      if (filePayload && typeof filePayload === "object" && filePayload.data) {
        periodData = filePayload;
      }
    } catch {}
  }

  if (!data.length) {
    try {
      const fileData = await readJson("season_avg.json");
      if (Array.isArray(fileData)) data = fileData;
    } catch {}
  }

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

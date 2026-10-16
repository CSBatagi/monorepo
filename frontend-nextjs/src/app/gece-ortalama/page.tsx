import { Suspense } from 'react';
import NightCenterClient from '@/components/NightCenterClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';
import { normalizeSeasonStarts } from '@/lib/seasonRanges';
import { isDateKeyedPeriodPayload } from '@/lib/statsPeriods';

export const revalidate = 60;

export default async function GeceOrtalamasiPage() {
  const season = (await readJson('season_start.json')) || {};
  const seasonStarts = normalizeSeasonStarts(season.season_starts, [season.season_start].filter(Boolean));
  const stats = await fetchStats('night_avg_periods', 'sonmac_by_date_periods');
  const current = 'season_' + season.season_start;
  const empty = { current_period: current, data: { [current]: {} } };
  return <div id="page-gece_ortalama" className="page-content"><Suspense fallback={<p role="status">Gece yükleniyor…</p>}><NightCenterClient nightPayload={isDateKeyedPeriodPayload(stats.night_avg_periods) ? stats.night_avg_periods : empty} matchPayload={isDateKeyedPeriodPayload(stats.sonmac_by_date_periods) ? stats.sonmac_by_date_periods : empty} seasonStarts={seasonStarts} /></Suspense></div>;
}

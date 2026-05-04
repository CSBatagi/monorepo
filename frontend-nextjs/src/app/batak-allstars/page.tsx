import BatakAllStarsClient from './BatakAllStarsClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';
import {
  getDateKeyedPeriodData,
  isDateKeyedPeriodPayload,
} from '@/lib/statsPeriods';
import { readDateKeyedRangeFromStaticHistory } from '@/lib/statsHistoryServer';

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function BatakAllStarsPage() {
  const seasonStartRaw = (await readJson('batak_allstars_season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const seasonEnd = typeof seasonStartRaw?.season_end === 'string' ? seasonStartRaw.season_end.split('T')[0] : null;
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('batak_allstars_config.json')) || null;
  // Batak All-Stars can use a range that differs from the global season.
  // SSR reads only the overlapping static season shards and passes the filtered range.
  const stats = await fetchStats('night_avg_periods', 'sonmac_by_date_periods', 'night_avg', 'sonmac_by_date');
  const nightAvgPeriods = isDateKeyedPeriodPayload<any[]>(stats.night_avg_periods) ? stats.night_avg_periods : null;
  const sonmacPeriods = isDateKeyedPeriodPayload<any>(stats.sonmac_by_date_periods) ? stats.sonmac_by_date_periods : null;
  const currentNightAvg = nightAvgPeriods?.current_period
    ? getDateKeyedPeriodData(nightAvgPeriods, nightAvgPeriods.current_period)
    : stats.night_avg || {};
  const currentSonmacByDate = sonmacPeriods?.current_period
    ? getDateKeyedPeriodData(sonmacPeriods, sonmacPeriods.current_period)
    : stats.sonmac_by_date || {};
  const nightAvg = await readDateKeyedRangeFromStaticHistory<any[]>({
    dataset: 'night_avg',
    payload: nightAvgPeriods,
    currentData: currentNightAvg,
    rangeStart: seasonStart,
    rangeEnd: seasonEnd,
  });
  const sonmacByDate = await readDateKeyedRangeFromStaticHistory<any>({
    dataset: 'sonmac_by_date',
    payload: sonmacPeriods,
    currentData: currentSonmacByDate,
    rangeStart: seasonStart,
    rangeEnd: seasonEnd,
  });
  return (
    <div id="page-batak_allstars" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Batak All-Stars Ligi</h2>
      <BatakAllStarsClient
        nightAvg={nightAvg}
        sonmacByDate={sonmacByDate}
        seasonStart={seasonStart}
        seasonEnd={seasonEnd}
        players={players}
        config={config}
      />
    </div>
  );
}

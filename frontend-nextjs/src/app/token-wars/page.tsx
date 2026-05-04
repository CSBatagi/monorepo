import TokenWarsClient from './TokenWarsClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from '@/lib/statsPeriods';

export const revalidate = 60;

export default async function TokenWarsPage() {
  const seasonStartRaw = (await readJson('season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('token_wars_config.json')) || null;
  // Use period variants so ISR receives the global current period without
  // sending all historical date-keyed datasets to the browser.
  const stats = await fetchStats('night_avg_periods', 'sonmac_by_date_periods', 'night_avg', 'sonmac_by_date');
  const nightAvgPeriods = isDateKeyedPeriodPayload<any[]>(stats.night_avg_periods) ? stats.night_avg_periods : null;
  const sonmacPeriods = isDateKeyedPeriodPayload<any>(stats.sonmac_by_date_periods) ? stats.sonmac_by_date_periods : null;
  const nightAvg = nightAvgPeriods?.current_period
    ? getDateKeyedPeriodData(nightAvgPeriods, nightAvgPeriods.current_period)
    : stats.night_avg || {};
  const sonmacByDate = sonmacPeriods?.current_period
    ? getDateKeyedPeriodData(sonmacPeriods, sonmacPeriods.current_period)
    : stats.sonmac_by_date || {};
  return (
    <div id="page-token_wars" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-purple-600 mb-4">Batak Token Wars</h2>
      <TokenWarsClient
        nightAvg={nightAvg}
        sonmacByDate={sonmacByDate}
        seasonStart={seasonStart}
        players={players}
        config={config}
      />
    </div>
  );
}

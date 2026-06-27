import SuperligaClient from './SuperligaClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from '@/lib/statsPeriods';

export const revalidate = 60;

export default async function SuperligaPage() {
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('superliga_config.json')) || null;
  const seasonStart = typeof config?.seasonStart === 'string' ? config.seasonStart.split('T')[0] : null;

  // Use the global current-period sonmac data; standings are filtered by the
  // Superliga season start, so only Superliga nights are scored.
  const stats = await fetchStats('sonmac_by_date_periods', 'sonmac_by_date');
  const sonmacPeriods = isDateKeyedPeriodPayload<any>(stats.sonmac_by_date_periods) ? stats.sonmac_by_date_periods : null;
  const sonmacByDate = sonmacPeriods?.current_period
    ? getDateKeyedPeriodData(sonmacPeriods, sonmacPeriods.current_period)
    : stats.sonmac_by_date || {};

  return (
    <div id="page-superliga" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-purple-600 mb-4">Superliga</h2>
      <SuperligaClient
        sonmacByDate={sonmacByDate}
        seasonStart={seasonStart}
        players={players}
        config={config}
      />
    </div>
  );
}

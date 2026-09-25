import MundialClient from './MundialClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from '@/lib/statsPeriods';
import { readDateKeyedRangeFromStaticHistory } from '@/lib/statsHistoryServer';
import type { SonmacNight } from '@/lib/batakAllStars';
import type { MundialConfig } from '@/lib/mundial';

export const revalidate = 60;

export default async function MundialPage() {
  const players = (await readJson('players.json')) || [];
  const rawConfig = await readJson('mundial_config.json');
  const config: MundialConfig | null = rawConfig && Array.isArray(rawConfig.pots) ? rawConfig : null;
  const seasonStart = typeof config?.seasonStart === 'string' ? config.seasonStart.split('T')[0] : null;

  // Nights are scored from the Mundial season start; read that range from the
  // current period plus any older static shards so a global season change
  // does not drop Mundial nights.
  const stats = await fetchStats('sonmac_by_date_periods', 'sonmac_by_date');
  const sonmacPeriods = isDateKeyedPeriodPayload<SonmacNight>(stats.sonmac_by_date_periods) ? stats.sonmac_by_date_periods : null;
  const currentSonmacByDate = sonmacPeriods?.current_period
    ? getDateKeyedPeriodData(sonmacPeriods, sonmacPeriods.current_period)
    : stats.sonmac_by_date || {};
  const sonmacByDate = await readDateKeyedRangeFromStaticHistory<SonmacNight>({
    dataset: 'sonmac_by_date',
    payload: sonmacPeriods,
    currentData: currentSonmacByDate,
    rangeStart: seasonStart,
    rangeEnd: null,
  });

  return (
    <div id="page-mundial" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">{config?.name || 'Batak Mundial'}</h2>
      <MundialClient sonmacByDate={sonmacByDate} players={players} config={config} />
    </div>
  );
}

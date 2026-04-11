import TokenWarsClient from './TokenWarsClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';

export const revalidate = 60;

function readSeasonStart(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const seasonStart = (value as { season_start?: unknown }).season_start;
  return typeof seasonStart === 'string' ? seasonStart.split('T')[0] : null;
}

function readCurrentPeriodStart(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;

  const periods = (value as { periods?: Array<{ is_current?: boolean; start_date?: unknown }> }).periods;
  if (Array.isArray(periods)) {
    const currentPeriod = periods.find((period) => period?.is_current);
    if (typeof currentPeriod?.start_date === 'string') {
      return currentPeriod.start_date.split('T')[0];
    }
  }

  const currentPeriodId = (value as { current_period?: unknown }).current_period;
  if (typeof currentPeriodId === 'string') {
    const match = /^season_(\d{4}-\d{2}-\d{2})$/.exec(currentPeriodId);
    if (match) return match[1];
  }

  return null;
}

export default async function TokenWarsPage() {
  const seasonPeriodsRaw = (await readJson('season_avg_periods.json')) || {};
  const seasonStartRaw = (await readJson('season_start.json')) || {};
  const seasonStart = readCurrentPeriodStart(seasonPeriodsRaw) || readSeasonStart(seasonStartRaw);
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('token_wars_config.json')) || null;
  const stats = await fetchStats('night_avg', 'sonmac_by_date');
  const nightAvg = stats.night_avg || {};
  const sonmacByDate = stats.sonmac_by_date || {};
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

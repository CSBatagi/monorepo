import TokenWarsClient from './TokenWarsClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';

export const revalidate = 60;

export default async function TokenWarsPage() {
  const seasonStartRaw = (await readJson('season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('token_wars_config.json')) || null;
  // Use _all variants: the season-filtered night_avg/sonmac_by_date can go stale
  // across season boundaries (ISR cache baked with old season data).
  // Client-side seasonStart filtering handles the rest.
  const stats = await fetchStats('night_avg_all', 'sonmac_by_date_all');
  const nightAvg = stats.night_avg_all || {};
  const sonmacByDate = stats.sonmac_by_date_all || {};
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

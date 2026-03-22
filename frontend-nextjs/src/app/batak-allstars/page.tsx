import BatakAllStarsClient from './BatakAllStarsClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function BatakAllStarsPage() {
  const seasonStartRaw = (await readJson('season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('batak_allstars_config.json')) || null;
  const stats = await fetchStats('night_avg', 'sonmac_by_date');
  const nightAvg = stats.night_avg || {};
  const sonmacByDate = stats.sonmac_by_date || {};
  return (
    <div id="page-batak_allstars" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Batak All-Stars Ligi</h2>
      <BatakAllStarsClient
        nightAvg={nightAvg}
        sonmacByDate={sonmacByDate}
        seasonStart={seasonStart}
        players={players}
        config={config}
      />
    </div>
  );
}

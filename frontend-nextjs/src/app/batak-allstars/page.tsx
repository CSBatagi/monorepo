import BatakAllStarsClient from './BatakAllStarsClient';
import { readJson } from '@/lib/dataReader';
import { fetchStats } from '@/lib/statsServer';

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function BatakAllStarsPage() {
  const seasonStartRaw = (await readJson('batak_allstars_season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const seasonEnd = typeof seasonStartRaw?.season_end === 'string' ? seasonStartRaw.season_end.split('T')[0] : null;
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('batak_allstars_config.json')) || null;
  // Use _all variants because the backend's season_start.json may differ from
  // batak_allstars_season_start.json. The client filters by seasonStart/seasonEnd.
  const stats = await fetchStats('night_avg_all', 'sonmac_by_date_all');
  const nightAvg = stats.night_avg_all || {};
  const sonmacByDate = stats.sonmac_by_date_all || {};
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

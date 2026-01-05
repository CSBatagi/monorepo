import BatakAllStarsClient from './BatakAllStarsClient';
import { readJson } from '@/lib/dataReader';

export const dynamic = 'force-dynamic';

export default async function BatakAllStarsPage() {
  const seasonStartRaw = (await readJson('season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const players = (await readJson('players.json')) || [];
  const config = (await readJson('batak_allstars_config.json')) || null;
  const nightAvg = (await readJson('night_avg.json')) || {};
  const sonmacByDate = (await readJson('sonmac_by_date.json')) || {};
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

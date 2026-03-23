import TeamPickerClient from './TeamPickerClient';
import { fetchStats } from '@/lib/statsServer';

export default async function TeamPickerPage() {
  const stats = await fetchStats('last10', 'season_avg');

  return (
    <TeamPickerClient
      initialLast10Stats={Array.isArray(stats.last10) ? stats.last10 : []}
      initialSeasonStats={Array.isArray(stats.season_avg) ? stats.season_avg : []}
    />
  );
}

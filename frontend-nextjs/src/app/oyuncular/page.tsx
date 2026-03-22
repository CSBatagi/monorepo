import OyuncularClient from "./OyuncularClient";
import { readJson } from "@/lib/dataReader";
import { fetchStats } from "@/lib/statsServer";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function OyuncularPage() {
  const stats = await fetchStats('players_stats', 'players_stats_periods');
  const playersStats = stats.players_stats || [];
  const playersStatsPeriods = stats.players_stats_periods || null;
  const playersList = (await readJson("players.json")) || [];

  const fallbackPeriods =
    playersStatsPeriods && playersStatsPeriods.data
      ? playersStatsPeriods
      : {
          current_period: "season_current",
          periods: [{ id: "season_current", label: "Guncel Sezon", is_current: true }],
          data: { season_current: Array.isArray(playersStats) ? playersStats : [] },
        };

  return (
    <div id="page-oyuncular" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Oyuncular</h2>
      <OyuncularClient initialStats={playersStats} initialPeriods={fallbackPeriods} playersList={playersList} />
    </div>
  );
}

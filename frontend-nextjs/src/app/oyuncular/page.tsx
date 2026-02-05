import OyuncularClient from "./OyuncularClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = "force-dynamic";

export default async function OyuncularPage() {
  const playersStats = (await readJson("players_stats.json")) || [];
  const playersStatsPeriods = (await readJson("players_stats_periods.json")) || null;
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

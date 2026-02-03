import OyuncularClient from "./OyuncularClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = "force-dynamic";

export default async function OyuncularPage() {
  const playersStats = (await readJson("players_stats.json")) || [];
  const playersList = (await readJson("players.json")) || [];
  return (
    <div id="page-oyuncular" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Oyuncular</h2>
      <OyuncularClient initialStats={playersStats} playersList={playersList} />
    </div>
  );
}

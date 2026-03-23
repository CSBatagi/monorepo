import React from "react";
import GecenInMVPsiClient from "../../components/GecenInMVPsiClient";
import { readJson } from "@/lib/dataReader";
import { fetchStats } from "@/lib/statsServer";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function GecenInMVPsiPage() {
  const seasonStartRaw = (await readJson('season_start.json')) || {};
  const seasonStart = typeof seasonStartRaw?.season_start === 'string' ? seasonStartRaw.season_start.split('T')[0] : null;
  const stats = await fetchStats('night_avg_all', 'night_avg');
  let nightAvg =
    stats.night_avg_all && typeof stats.night_avg_all === 'object' && !Array.isArray(stats.night_avg_all)
      ? stats.night_avg_all
      : {};
  if (!Object.keys(nightAvg).length && stats.night_avg && typeof stats.night_avg === 'object' && !Array.isArray(stats.night_avg)) {
    nightAvg = stats.night_avg;
  }
  const players = (await readJson('players.json')) || [];
  
  return (
    <div id="page-gecenin-mvpsi" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gecenin MVP'si - Bu gece maçı kazanmada en çok kim etkili oldu?</h2>
      <GecenInMVPsiClient
        nightAvg={nightAvg}
        players={players}
        seasonStart={seasonStart}
      />
    </div>
  );
}

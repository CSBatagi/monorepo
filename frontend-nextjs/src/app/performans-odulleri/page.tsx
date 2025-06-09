import fs from "fs/promises";
import path from "path";
import React from "react";
import AwardsListClient from "../../components/AwardsListClient";

interface PlayerAward {
  name: string;
  totalHltvDiff: number;
  totalAdrDiff: number;
  gameCount: number;
  performanceScore: number;
  avgHltvDiff: number;
  avgAdrDiff: number;
}

interface Awards {
  top3: PlayerAward[];
  bottom3: PlayerAward[];
}

interface Period {
  start: Date;
  end: Date;
  displayStart: string;
  displayEnd: string;
  key: string;
}

async function getSeasonStartDate(): Promise<Date> {
  try {
    const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/season_start.json");
    const file = await fs.readFile(filePath, "utf-8");
    const json = JSON.parse(file);
    if (json && typeof json.season_start === "string") {
      return new Date(json.season_start);
    }
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/season_start.json"), "utf-8");
      const json = JSON.parse(file);
      if (json && typeof json.season_start === "string") {
        return new Date(json.season_start);
      }
    } catch (e2) {}
  }
  // fallback to previous hardcoded date
  return new Date("2025-02-10T00:00:00Z");
}

function getAllTwoWeekPeriods(seasonStart: Date, untilDate: Date): Period[] {
  const periods: Period[] = [];
  let startDate = new Date(seasonStart);
  const formatDate = (date: Date) => date.toISOString().split("T")[0];
  while (startDate <= untilDate) {
    const endDate = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000 - 1);
    periods.push({
      start: new Date(startDate),
      end: endDate,
      displayStart: formatDate(startDate),
      displayEnd: formatDate(endDate),
      key: `${formatDate(startDate)}_${formatDate(endDate)}`,
    });
    startDate.setDate(startDate.getDate() + 14);
  }
  return periods;
}

function calculateAwards(allData: any, period: Period): Awards {
  // Map: steamId -> array of valid games in the period
  const playerGames: Record<string, Array<{ name: string; hltv2Diff: number; adrDiff: number }>> = {};

  for (const dateStr in allData) {
    const gameDate = new Date(dateStr + "T00:00:00Z");
    if (gameDate >= period.start && gameDate <= period.end) {
      allData[dateStr].forEach((playerStats: any) => {
        const steamId = playerStats.steam_id;
        const hltv2 = parseFloat(playerStats["HLTV 2"]) || 0;
        const adr = parseFloat(playerStats["ADR"]) || 0;
        const hltv2Diff = parseFloat(playerStats["HLTV2 DIFF"]) || 0;
        const adrDiff = parseFloat(playerStats["ADR DIFF"]) || 0;
        // Only include if this is NOT their first game (i.e., at least one of the diffs is not equal to the raw value)
        if (hltv2Diff !== hltv2 || adrDiff !== adr) {
          if (!playerGames[steamId]) playerGames[steamId] = [];
          playerGames[steamId].push({
            name: playerStats.name,
            hltv2Diff,
            adrDiff,
          });
        }
      });
    }
  }

  const aggregatedPlayers = Object.entries(playerGames)
    .map(([steamId, games]) => {
      if (games.length === 0) return null;
      const name = games[0].name;
      const totalHltvDiff = games.reduce((sum, g) => sum + g.hltv2Diff, 0);
      const totalAdrDiff = games.reduce((sum, g) => sum + g.adrDiff, 0);
      const avgHltvDiff = totalHltvDiff / games.length;
      const avgAdrDiff = totalAdrDiff / games.length;
      return {
        name,
        totalHltvDiff,
        totalAdrDiff,
        gameCount: games.length,
        performanceScore: avgHltvDiff * 70 + avgAdrDiff,
        avgHltvDiff,
        avgAdrDiff,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b as any).performanceScore - (a as any).performanceScore);

  const top3 = aggregatedPlayers.slice(0, 3) as any[];
  const bottom3 = aggregatedPlayers.slice(-3).reverse() as any[];
  return { top3, bottom3 };
}

export default async function PerformansOdulleriPage() {
  // Load JSON on the server
  let data: any = {};
  let seasonStart: Date = new Date("2025-02-10T00:00:00Z");
  try {
    seasonStart = await getSeasonStartDate();
  } catch {}
  try {
    const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/night_avg.json");
    const file = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/night_avg.json"), "utf-8");
      data = JSON.parse(file);
    } catch (e2) {
      data = {};
    }
  }

  const now = new Date();
  const periods = getAllTwoWeekPeriods(seasonStart, now);
  const awardsByPeriod = periods.map((period) => ({
    period,
    awards: calculateAwards(data, period),
  }));

  return (
    <div id="page-performans-odulleri" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Performans Ödülleri</h2>
      {awardsByPeriod.length === 0 && (
        <p className="text-gray-500">Hiç veri bulunamadı.</p>
      )}
      {awardsByPeriod.length > 0 && (
        <div className="space-y-8">
          {[...awardsByPeriod].reverse().map(({ period, awards }) => (
            <div key={period.key} className="border rounded-lg bg-white shadow-none p-4">
              <h3 className="text-2xl font-bold text-blue-700 mb-4">
                Dönem: {period.displayStart} - {period.displayEnd}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h4 className="text-xl font-bold text-green-700 mb-3">En İyi Performans Gösterenler (Top 3)</h4>
                  {awards.top3.length === 0 ? (
                    <p className="text-gray-500">Bu dönem için en iyi performans gösteren oyuncu bulunmuyor.</p>
                  ) : (
                    <AwardsListClient players={awards.top3} color="green" />
                  )}
                </div>
                <div>
                  <h4 className="text-xl font-bold text-red-700 mb-3">En Düşük Performans Gösterenler (Bottom 3)</h4>
                  {awards.bottom3.length === 0 ? (
                    <p className="text-gray-500">Bu dönem için en düşük performans gösteren oyuncu bulunmuyor.</p>
                  ) : (
                    <AwardsListClient players={awards.bottom3} color="red" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 
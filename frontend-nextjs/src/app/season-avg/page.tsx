import SeasonStatsTable, { columns } from "@/components/SeasonStatsTable";
import path from "path";
import fs from "fs/promises";
import SeasonAvgRadarGraphs from "@/components/SeasonAvgRadarGraphs";
import SeasonAvgTabsClient from "@/components/SeasonAvgTabsClient";

export default async function SeasonAvgPage() {
  // Read the JSON file from the public directory at build/runtime
  const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/season_avg.json");
  let data: any[] = [];
  try {
    const file = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/season_avg.json"), "utf-8");
      data = JSON.parse(file);
    } catch (e2) {
      data = [];
    }
  }

  return (
    <div id="page-season_avg" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Sezon Ortalaması</h2>
      <SeasonAvgTabsClient data={data} />
    </div>
  );
} 
import SeasonStatsTable, { columns } from "@/components/SeasonStatsTable";
import path from "path";
import fs from "fs/promises";

export default async function SeasonAvgPage() {
  // Read the JSON file from the public directory at build/runtime
  const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/season_avg.json");
  let data = [];
  try {
    const file = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/season_avg.json"), "utf-8");
      data = JSON.parse(file);
    } catch (e2) {
      data = null;
    }
  }

  return (
    <div id="page-season_avg" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Sezon Ortalaması</h2>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="season-avg-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg active" id="season-avg-table-tab" data-tabs-target="#season-avg-tab-table" type="button" role="tab" aria-controls="season-avg-tab-table" aria-selected="true">Table</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="season-avg-graph-tab" data-tabs-target="#season-avg-tab-graph" type="button" role="tab" aria-controls="season-avg-tab-graph" aria-selected="false">Graph</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="season-avg-head2head-tab" data-tabs-target="#season-avg-tab-head2head" type="button" role="tab" aria-controls="season-avg-tab-head2head" aria-selected="false">Head-to-Head</button>
          </li>
        </ul>
      </div>
      <div id="season-avg-tab-content">
        {/* Table Content */}
        <div id="season-avg-tab-table" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-table-tab">
          <div className="overflow-x-auto">
            <SeasonStatsTable data={data} />
          </div>
        </div>
        {/* Graph Content (Initially Hidden) */}
        <div id="season-avg-tab-graph" className="season-avg-tab-pane hidden" role="tabpanel" aria-labelledby="season-avg-graph-tab">
          <p className="text-center p-4">Graph content loading...</p>
        </div>
        {/* Head-to-Head Content (Initially Hidden) */}
        <div id="season-avg-tab-head2head" className="season-avg-tab-pane hidden" role="tabpanel" aria-labelledby="season-avg-head2head-tab">
          <p className="text-center p-4">Head-to-Head content loading...</p>
        </div>
      </div>
    </div>
  );
} 
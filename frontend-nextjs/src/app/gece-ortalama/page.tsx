import NightAvgTableClient from "@/components/NightAvgTableClient";
import path from "path";
import fs from "fs/promises";

export default async function GeceOrtalamasiPage() {
  // Read the JSON file from the public directory at build/runtime
  const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/night_avg.json");
  let allData: Record<string, any[]> = {};
  try {
    const file = await fs.readFile(filePath, "utf-8");
    allData = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/night_avg.json"), "utf-8");
      allData = JSON.parse(file);
    } catch (e2) {
      allData = {};
    }
  }
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-gece_ortalama" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gece Ortalaması</h2>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="night-avg-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg active" id="night-avg-table-tab" data-tabs-target="#night-avg-tab-table" type="button" role="tab" aria-controls="night-avg-tab-table" aria-selected="true">Table</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="night-avg-graph-tab" data-tabs-target="#night-avg-tab-graph" type="button" role="tab" aria-controls="night-avg-tab-graph" aria-selected="false">Graph</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="night-avg-head2head-tab" data-tabs-target="#night-avg-tab-head2head" type="button" role="tab" aria-controls="night-avg-tab-head2head" aria-selected="false">Head-to-Head</button>
          </li>
        </ul>
      </div>
      <NightAvgTableClient allData={allData} dates={dates} />
      <div id="night-avg-tab-content">
        {/* Table Content */}
        <div id="night-avg-tab-table" className="night-avg-tab-pane active" role="tabpanel" aria-labelledby="night-avg-table-tab">
          {/* Table is rendered in NightAvgTableClient */}
        </div>
        {/* Graph Content (Initially Hidden) */}
        <div id="night-avg-tab-graph" className="night-avg-tab-pane hidden" role="tabpanel" aria-labelledby="night-avg-graph-tab">
          <p className="text-center p-4">Graph content loading...</p>
        </div>
        {/* Head-to-Head Content (Initially Hidden) */}
        <div id="night-avg-tab-head2head" className="night-avg-tab-pane hidden" role="tabpanel" aria-labelledby="night-avg-head2head-tab">
          <p className="text-center p-4">Head-to-Head content loading...</p>
        </div>
      </div>
    </div>
  );
} 
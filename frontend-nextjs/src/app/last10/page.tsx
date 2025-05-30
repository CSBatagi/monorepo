import SeasonStatsTable from "@/components/SeasonStatsTable";
import path from "path";
import fs from "fs/promises";

export default async function Last10Page() {
  // Read the JSON file from the public directory at build/runtime
  const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/last10.json");
  let data: any[] | null = [];
  try {
    const file = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/last10.json"), "utf-8");
      data = JSON.parse(file);
    } catch (e2) {
      data = null;
    }
  }

  return (
    <div id="page-last10" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son 10 Ortalaması</h2>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="last10-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg active" id="last10-table-tab" data-tabs-target="#last10-tab-table" type="button" role="tab" aria-controls="last10-tab-table" aria-selected="true">Table</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="last10-graph-tab" data-tabs-target="#last10-tab-graph" type="button" role="tab" aria-controls="last10-tab-graph" aria-selected="false">Graph</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="last10-head2head-tab" data-tabs-target="#last10-tab-head2head" type="button" role="tab" aria-controls="last10-tab-head2head" aria-selected="false">Head-to-Head</button>
          </li>
        </ul>
      </div>
      <div id="last10-tab-content">
        {/* Table Content */}
        <div id="last10-tab-table" className="last10-tab-pane active" role="tabpanel" aria-labelledby="last10-table-tab">
          <div className="overflow-x-auto">
            <SeasonStatsTable data={data} />
          </div>
        </div>
        {/* Graph Content (Initially Hidden) */}
        <div id="last10-tab-graph" className="last10-tab-pane hidden" role="tabpanel" aria-labelledby="last10-graph-tab">
          <p className="text-center p-4">Graph content loading...</p>
        </div>
        {/* Head-to-Head Content (Initially Hidden) */}
        <div id="last10-tab-head2head" className="last10-tab-pane hidden" role="tabpanel" aria-labelledby="last10-head2head-tab">
          <p className="text-center p-4">Head-to-Head content loading...</p>
        </div>
      </div>
    </div>
  );
} 
export default function SeasonAvgPage() {
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
            <table className="styled-table min-w-full text-sm">
              {/* Table headers from index.html */}
              <thead><tr><th className="text-center p-4">Table content loading...</th></tr></thead>
              <tbody id="season-avg-table-body">
                {/* Data rows will be injected here by JS */}
              </tbody>
            </table>
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
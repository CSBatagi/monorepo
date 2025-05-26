export default function PerformanceGraphsPage() {
  return (
    <div id="page-performance_graphs" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Performans Grafikleri</h2>

      {/* Controls: Player Selector and Metric Selector */}
      <div className="mb-4 flex flex-wrap items-center gap-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Metric Seç (Tablo & Grafik için):</label>
          <div className="flex items-center space-x-4">
            <label className="inline-flex items-center">
              <input type="radio" className="form-radio" name="performance-metric" value="adr" defaultChecked />
              <span className="ml-2">ADR</span>
            </label>
            <label className="inline-flex items-center">
              <input type="radio" className="form-radio" name="performance-metric" value="hltv_2" />
              <span className="ml-2">HLTV 2.0</span>
            </label>
          </div>
        </div>
      </div>

      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="performance-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg active" id="performance-table-tab" data-tabs-target="#performance-tab-table" type="button" role="tab" aria-controls="performance-tab-table" aria-selected="true">Table</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="performance-graph-tab" data-tabs-target="#performance-tab-graph" type="button" role="tab" aria-controls="performance-tab-graph" aria-selected="false">Graph</button>
          </li>
        </ul>
      </div>

      {/* Tab Content */}
      <div id="performance-tab-content">
        {/* Table Content */}
        <div id="performance-tab-table" className="performance-tab-pane active" role="tabpanel" aria-labelledby="performance-table-tab">
          <div className="overflow-x-auto">
            <table className="styled-table min-w-full text-sm">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>HLTV 2.0</th>
                  <th>ADR</th>
                </tr>
              </thead>
              <tbody id="performance-table-body">
                <tr><td colSpan={3} className="text-center py-4 text-gray-500">Select a player to view performance data.</td></tr>
                {/* Data rows will be injected here by JS */}
              </tbody>
            </table>
          </div>
        </div>
        {/* Graph Content (Initially Hidden) */}
        <div id="performance-tab-graph" className="performance-tab-pane hidden" role="tabpanel" aria-labelledby="performance-graph-tab">
          <div className="flex flex-col md:flex-row gap-4">
            <div id="performance-player-toggles" className="md:w-1/4 lg:w-1/5 p-3 border rounded-lg bg-gray-50 shadow-sm self-start">
              <p className="text-sm text-gray-600 mb-2">Oyuncuları Göster/Gizle:</p>
              <div className="flex space-x-2 mb-2">
                <button id="select-all-players" className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">Tümünü Seç</button>
                <button id="deselect-all-players" className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors">Tümünü Bırak</button>
              </div>
              <div id="performance-player-toggles-list" className="space-y-1">
                <span className="text-xs text-gray-500">Loading players...</span>
              </div>
            </div>
            <div className="relative w-full md:w-3/4 lg:w-4/5 h-96 md:h-[500px]">
              <canvas id="performance-chart"></canvas>
              <p id="performance-graph-placeholder" className="text-center py-8 text-gray-500 absolute inset-0 flex items-center justify-center">Loading graph...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
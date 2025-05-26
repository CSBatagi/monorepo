export default function GeceOrtalamasiPage() {
  return (
    <div id="page-gece_ortalama" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gece Ortalaması</h2>
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <label htmlFor="night-avg-date-selector" className="block text-sm font-medium text-gray-700 mb-1">Tarih Seçin:</label>
        <select id="night-avg-date-selector" className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
          <option>Tarihler yükleniyor...</option>
        </select>
      </div>
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
      <div id="night-avg-tab-content">
        {/* Table Content */}
        <div id="night-avg-tab-table" className="night-avg-tab-pane active" role="tabpanel" aria-labelledby="night-avg-table-tab">
          <div className="overflow-x-auto">
            <table className="styled-table min-w-full text-sm">
              {/* Table headers from index.html */}
              <thead><tr><th className="text-center p-4">Table content loading...</th></tr></thead>
              <tbody id="night-avg-table-body">
                {/* Data rows will be injected here by JS */}
              </tbody>
            </table>
          </div>
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
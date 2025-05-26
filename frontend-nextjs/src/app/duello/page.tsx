export default function DuelloPage() {
  return (
    <div id="page-duello" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Düello</h2>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="duello-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg active" id="duello-sonmac-tab" data-tabs-target="#duello-tab-sonmac" type="button" role="tab" aria-controls="duello-tab-sonmac" aria-selected="true">Son Maç</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className="map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg" id="duello-sezon-tab" data-tabs-target="#duello-tab-sezon" type="button" role="tab" aria-controls="duello-tab-sezon" aria-selected="false">Sezon</button>
          </li>
        </ul>
      </div>
      {/* Tab Content */}
      <div id="duello-tab-content">
        {/* Son Mac Tab Content */}
        <div id="duello-tab-sonmac" className="duello-tab-pane active" role="tabpanel" aria-labelledby="duello-sonmac-tab">
          <div id="duello-grid-container" className="overflow-x-auto w-full">
            <table id="duello-table" className="table-fixed border-collapse" style={{ minWidth: '1200px' }}>
              <thead>
                <tr>
                  <th className="w-32 p-3 border bg-gray-50 font-semibold text-gray-700 sticky left-0 z-10"></th>
                  <th colSpan={20} className="text-center p-4 text-gray-500">Loading Son Maç duels...</th>
                </tr>
              </thead>
              {/* Son Mac table body populated by JS */}
              <tbody><tr><td colSpan={21} className="text-center p-4">Duel table content loading...</td></tr></tbody>
            </table>
          </div>
        </div>
        {/* Sezon Tab Content (Initially Hidden) */}
        <div id="duello-tab-sezon" className="duello-tab-pane hidden" role="tabpanel" aria-labelledby="duello-sezon-tab">
          <div id="duello-sezon-grid-container" className="overflow-x-auto w-full">
            <table id="duello-sezon-table" className="table-fixed border-collapse" style={{ minWidth: '1200px' }}>
              <thead>
                <tr>
                  <th className="w-32 p-3 border bg-gray-50 font-semibold text-gray-700 sticky left-0 z-10"></th>
                  <th colSpan={20} className="text-center p-4 text-gray-500">Loading Sezon duels...</th>
                </tr>
              </thead>
              {/* Sezon table body populated by JS */}
              <tbody><tr><td colSpan={21} className="text-center p-4">Duel table content loading...</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
} 
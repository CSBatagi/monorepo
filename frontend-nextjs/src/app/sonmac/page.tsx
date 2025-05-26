export default function SonMacPage() {
  return (
    <div id="page-sonmac" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son Maç</h2>
      
      {/* Date Selector for Son Mac */}
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <label htmlFor="sonmac-date-selector" className="block text-sm font-medium text-gray-700 mb-1">Tarih Seçin:</label>
        <select id="sonmac-date-selector" className="form-select block w-full mt-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
          <option>Tarihler yükleniyor...</option>
        </select>
      </div>
      {/* End Date Selector */}

      {/* Map tabs navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="map-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center">
          {/* Map tabs will be dynamically generated here */}
          <li className="text-gray-500 p-4">Map tabs loading...</li>
        </ul>
      </div>
      
      {/* Map tab content */}
      <div id="mapTabContent">
        {/* Map content will be dynamically generated here */}
        <div className="text-gray-500 p-4">Map content loading...</div>
      </div>
    </div>
  );
} 
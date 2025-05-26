export default function TeamPickerPage() {
  return (
    <div id="page-team_picker" className="page-content">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Available Players Section */}
        <div className="lg:col-span-2 page-content-container">
          <h2 className="text-lg font-semibold mb-2 text-blue-600">Available Players</h2>
          <div id="available-players" className="space-y-2 max-h-[500px] overflow-y-auto">
            {/* Available players will be populated here */}
            <div className="text-center py-4 text-gray-500">Loading available players...</div>
          </div>
        </div>

        {/* Team Selection Section */}
        <div className="lg:col-span-3 page-content-container">
          <h2 className="text-2xl font-semibold mb-4 text-blue-600">Team Selection</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Team A */}
            <div className="team-container">
              <div className="bg-blue-100 p-2 rounded-lg mb-4">
                <h3 className="text-xl font-semibold text-blue-600 mb-2">Team A</h3>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kabile</label>
                  <select id="team-a-kabile" className="form-select w-full rounded-md border-gray-300 shadow-sm">
                    <option value="">Select Kabile</option>
                    {/* Options will be populated from JSON data */}
                  </select>
                </div>
                <div id="team-a-players" className="team-list bg-blue-50 border border-blue-200 rounded shadow-sm min-h-[100px] overflow-y-auto">
                  {/* Player rows will be added here */}
                </div>
              </div>
            </div>

            {/* Team B */}
            <div className="team-container">
              <div className="bg-green-100 p-2 rounded-lg mb-4">
                <h3 className="text-xl font-semibold text-green-600 mb-2">Team B</h3>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kabile</label>
                  <select id="team-b-kabile" className="form-select w-full rounded-md border-gray-300 shadow-sm">
                    <option value="">Select Kabile</option>
                    {/* Options will be populated from JSON data */}
                  </select>
                </div>
                <div id="team-b-players" className="team-list bg-green-50 border border-green-200 rounded shadow-sm min-h-[100px] overflow-y-auto">
                  {/* Player rows will be added here */}
                </div>
              </div>
            </div>
          </div>
          {/* Team Stats Difference Section will go here from index.html */}
        </div>
      </div>
    </div>
  );
} 
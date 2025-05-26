export default function PerformansOdulleriPage() {
  return (
    <div id="page-performans-odulleri" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Performans Ödülleri</h2>
      <div className="mb-4 p-4 border rounded-lg bg-gray-50 shadow-sm">
        <p className="text-lg font-medium text-gray-700">Dönem: <span id="performans-odulleri-donem" className="font-semibold text-blue-500">Yükleniyor...</span></p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xl font-semibold text-green-600 mb-3">En İyi Performans Gösterenler (Top 3)</h3>
          <div id="top-performers" className="space-y-3">
            {/* Top performers will be populated here */}
            <p className="text-gray-500">Veriler yükleniyor veya bu dönem için veri bulunmuyor...</p>
          </div>
        </div>
        <div>
          <h3 className="text-xl font-semibold text-red-600 mb-3">En Düşük Performans Gösterenler (Bottom 3)</h3>
          <div id="bottom-performers" className="space-y-3">
            {/* Bottom performers will be populated here */}
            <p className="text-gray-500">Veriler yükleniyor veya bu dönem için veri bulunmuyor...</p>
          </div>
        </div>
      </div>
    </div>
  );
} 
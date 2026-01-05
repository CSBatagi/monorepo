import Link from 'next/link';

export default function Home() {
  return (
    <div id="page-home" className="page-content">
      <h2 className="text-3xl font-semibold text-blue-600 mb-6 text-center">CS Batağı Sitesine Hoş Geldiniz!</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Link href="/attendance" data-page-target="attendance" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Katılım</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Oyuncu katılım durumunu görüntüleyin ve güncelleyin.</p>
        </Link>
        <Link href="/team-picker" data-page-target="team_picker" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Takım Seçme</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Gelen oyuncuları takımlara atayın.</p>
        </Link>
        <Link href="/batak-domination" data-page-target="batak_domination" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Batak Domination</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Domination haritasını kontrol edin.</p>
        </Link>
        <Link href="/batak-allstars" data-page-target="batak_allstars" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Batak All-Stars</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Lig puanları, kaptanlar ve token sistemi.</p>
        </Link>
        <Link href="/sonmac" data-page-target="sonmac" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Son Maç</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Son maçın detaylı istatistikleri.</p>
        </Link>
        <Link href="/duello" data-page-target="duello" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Düello</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Oyuncu vs Oyuncu düello istatistikleri.</p>
        </Link>
        <Link href="/gece-ortalama" data-page-target="gece_ortalama" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Gece Ortalaması</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Gecelik ortalama performans.</p>
        </Link>
        <Link href="/last10" data-page-target="last10" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Son 10 Ortalaması</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Son 10 oyunun ortalamaları.</p>
        </Link>
        <Link href="/season-avg" data-page-target="season_avg" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Sezon Ortalaması</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Genel sezon ortalama istatistikleri.</p>
        </Link>
        <Link href="/performance" data-page-target="performance" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Performans Grafikleri</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Zaman içindeki oyuncu performansını takip edin.</p>
        </Link>
        <Link href="/performans-odulleri" data-page-target="performans-odulleri" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Performans Ödülleri</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">İki haftalık periyotlarla oyuncuların gelişimini takip edin.</p>
        </Link>
        <Link href="/mac-sonuclari" data-page-target="mac-sonuclari" className="landing-tile group block flex flex-col justify-center items-center text-center p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500 transition-all duration-200 ease-in-out">
          <h3 className="mb-1 text-lg font-bold text-blue-700 group-hover:text-blue-800">Maç Sonuçları</h3>
          <p className="hidden sm:inline text-sm font-normal text-gray-600 group-hover:text-gray-800">Tüm maçların skorlarını ve oyuncu listesini görüntüleyin.</p>
        </Link>
      </div>
    </div>
  );
}

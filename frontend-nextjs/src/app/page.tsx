'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';

const tiles = [
  { href: '/attendance', title: 'Katılım', desc: 'Oyuncu Katılım durumunu görüntüleyin ve güncelleyin.', icon: '📋' },
  { href: '/team-picker', title: 'Takım Seçme', desc: 'Gelen oyuncuları takımlara atayın.', icon: '⚔️' },
  { href: '/batak-domination', title: 'Batak Domination', desc: 'Domination haritasını kontrol edin.', icon: '🗺️' },
  { href: '/batak-allstars', title: 'Batak All-Stars', desc: 'Lig puanları, kaptanlar ve token sistemi.', icon: '⭐' },
  { href: '/sonmac', title: 'Son Maç', desc: 'Son Maçın detaylı istatistikleri.', icon: '🎯' },
  { href: '/duello', title: 'Düello', desc: 'Oyuncu vs Oyuncu Düello istatistikleri.', icon: '🔫' },
  { href: '/gece-ortalama', title: 'Gece Ortalaması', desc: 'Gecelik ortalama performans.', icon: '🌙' },
  { href: '/last10', title: 'Son 10 Ortalaması', desc: 'Son 10 oyunun ortalamaları.', icon: '🔟' },
  { href: '/season-avg', title: 'Sezon Ortalaması', desc: 'Genel sezon ortalama istatistikleri.', icon: '📊' },
  { href: '/oyuncular', title: 'Oyuncular', desc: 'Oyuncu bazlı detaylı istatistikler.', icon: '👤' },
  { href: '/performance', title: 'Performans Grafikleri', desc: 'Zaman içindeki oyuncu performansını takip edin.', icon: '📈' },
  { href: '/performans-odulleri', title: 'Performans Ödülleri', desc: 'Aylık periyotlarla oyuncuların gelişimini takip edin.', icon: '🏆' },
  { href: '/gecenin-mvpsi', title: "Gecenin MVP'si", desc: 'Bu gece maçı kazanmada en çok kim etkili oldu?', icon: '👑' },
  { href: '/mac-sonuclari', title: 'Maç Sonuçları', desc: 'Tüm maçların skorlarını ve oyuncu listesini görüntüleyin.', icon: '📝' },
  { href: '/mac-videolari', title: 'Maç Videoları', desc: 'Maç Videolarını izleyin.', icon: '🎬' },
];

export default function Home() {
  const { isDark } = useTheme();

  return (
    <div id="page-home" className="page-content">
      <h2 className={`text-3xl font-semibold mb-8 text-center ${
        isDark ? 'text-blue-400' : 'text-blue-600'
      }`}>
        CS Batağı Sitesine Hoş Geldiniz!
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={`landing-tile group block flex flex-col justify-center items-center text-center p-5 rounded-xl transition-all duration-300 ease-in-out ${
              isDark
                ? 'bg-dark-surface border border-dark-border hover:border-blue-500/50 hover:bg-dark-card shadow-lg shadow-black/20 hover:shadow-blue-900/20'
                : 'bg-gray-50 border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500'
            }`}
          >
            <span className="text-2xl mb-2 group-hover:scale-110 transition-transform duration-200">{tile.icon}</span>
            <h3 className={`mb-1 text-lg font-bold transition-colors ${
              isDark
                ? 'text-blue-400 group-hover:text-blue-300'
                : 'text-blue-700 group-hover:text-blue-800'
            }`}>
              {tile.title}
            </h3>
            <p className={`hidden sm:inline text-sm font-normal transition-colors ${
              isDark
                ? 'text-gray-400 group-hover:text-gray-300'
                : 'text-gray-600 group-hover:text-gray-800'
            }`}>
              {tile.desc}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}




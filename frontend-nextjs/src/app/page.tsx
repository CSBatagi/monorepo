'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import {
  ClipboardList,
  Swords,
  Map,
  Star,
  Crosshair,
  Target,
  Moon,
  ListOrdered,
  BarChart3,
  User,
  TrendingUp,
  Trophy,
  Crown,
  FileText,
  Clapperboard,
  type LucideIcon,
} from 'lucide-react';

const tiles: { href: string; title: string; desc: string; icon: LucideIcon }[] = [
  { href: '/attendance', title: 'Katılım', desc: 'Katılımı görüntüleyin ve güncelleyin.', icon: ClipboardList },
  { href: '/team-picker', title: 'Takım Seçme', desc: 'Oyuncuları takımlara atayın.', icon: Swords },
  { href: '/batak-domination', title: 'Batak Domination', desc: 'Domination haritasını yönetin.', icon: Map },
  { href: '/batak-allstars', title: 'Batak All-Stars', desc: 'Lig puanı ve token tablosu.', icon: Star },
  { href: '/sonmac', title: 'Son Maç', desc: 'Son maçın detaylı istatistikleri.', icon: Crosshair },
  { href: '/duello', title: 'Düello', desc: 'Oyuncu karşılaştırma istatistikleri.', icon: Target },
  { href: '/gece-ortalama', title: 'Gece Ortalaması', desc: 'Gecelik ortalama performans verisi.', icon: Moon },
  { href: '/last10', title: 'Son 10 Ortalaması', desc: 'Son 10 maç ortalamaları.', icon: ListOrdered },
  { href: '/season-avg', title: 'Sezon Ortalaması', desc: 'Sezon genel ortalama verileri.', icon: BarChart3 },
  { href: '/oyuncular', title: 'Oyuncular', desc: 'Oyuncu bazlı temel istatistikler.', icon: User },
  { href: '/performance', title: 'Performans Grafikleri', desc: 'Zamana göre performans takibi.', icon: TrendingUp },
  { href: '/performans-odulleri', title: 'Performans Ödülleri', desc: 'Periyot bazlı gelişim karşılaştırması.', icon: Trophy },
  { href: '/gecenin-mvpsi', title: "Gecenin MVP'si", desc: 'Gecenin en etkili oyuncusu.', icon: Crown },
  { href: '/mac-sonuclari', title: 'Maç Sonuçları', desc: 'Maç skorları ve oyuncu listeleri.', icon: FileText },
  { href: '/mac-videolari', title: 'Maç Videoları', desc: 'Maç tekrar videolarını izleyin.', icon: Clapperboard },
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
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 w-full max-w-7xl mx-auto">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
          <Link
            key={tile.href}
            href={tile.href}
            className={`landing-tile group flex items-center gap-3 p-3.5 sm:p-4 min-h-[92px] sm:min-h-[100px] rounded-xl transition-all duration-300 ease-in-out ${
              isDark
                ? 'bg-dark-surface border border-dark-border hover:border-blue-500/50 hover:bg-dark-card shadow-lg shadow-black/20 hover:shadow-blue-900/20'
                : 'bg-gray-50 border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-100 hover:border-blue-500'
            }`}
          >
            <Icon className={`w-9 h-9 sm:w-10 sm:h-10 shrink-0 group-hover:scale-110 transition-transform duration-200 ${
              isDark ? 'text-blue-400' : 'text-blue-600'
            }`} strokeWidth={1.75} />
            <div className="text-left min-w-0 flex-1">
              <h3 className={`mb-0.5 text-sm sm:text-base font-bold leading-tight transition-colors ${
                isDark
                  ? 'text-blue-400 group-hover:text-blue-300'
                  : 'text-blue-700 group-hover:text-blue-800'
              }`}>
                {tile.title}
              </h3>
              <p className={`text-[11px] sm:text-xs font-normal leading-tight transition-colors ${
                isDark
                  ? 'text-gray-400 group-hover:text-gray-300'
                  : 'text-gray-600 group-hover:text-gray-800'
              }`}>
                {tile.desc}
              </p>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}




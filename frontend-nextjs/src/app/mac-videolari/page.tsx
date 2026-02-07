'use client';

import { useTheme } from '@/contexts/ThemeContext';

export default function MacVideolariPage() {
  const { isDark } = useTheme();
  const playlistUrl = 'https://www.youtube.com/playlist?list=PLL0VhWmE7Ol4ZDkxDp837vA0Y0_QF3_KT';

  return (
    <div id="page-mac-videolari" className={`page-content page-content-container ${isDark ? 'bg-dark-surface border-dark-border' : ''}`}>
      <h2 className={`text-2xl font-semibold mb-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Maç Videoları</h2>
      <div className="w-full">
        <iframe
          className={`w-full aspect-video rounded-lg shadow-lg ${isDark ? 'border border-dark-border' : ''}`}
          style={{ border: isDark ? '1px solid #1a2340' : '1px solid rgba(0, 0, 0, 0.1)' }}
          src="https://www.youtube.com/embed/videoseries?si=LMIPvbLjHwNAbtJS&list=PLL0VhWmE7Ol4ZDkxDp837vA0Y0_QF3_KT"
          title="Maç Videoları"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
        />
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Maç videoları playlistini YouTube'de açmak için linke tıklayın.
        </p>
        <a
          href={playlistUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium shadow-sm transition-colors ${
            isDark 
              ? 'bg-blue-600/80 hover:bg-blue-500 text-white border border-blue-500/30' 
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          Playlist'i YouTube'da Aç
        </a>
      </div>
    </div>
  );
}

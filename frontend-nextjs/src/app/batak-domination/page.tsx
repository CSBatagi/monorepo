'use client';

import { useTheme } from '@/contexts/ThemeContext';

export default function BatakDominationPage() {
  const { isDark } = useTheme();

  return (
    <div id="page-batak_domination" className={`page-content page-content-container ${isDark ? 'bg-dark-surface border-dark-border' : ''}`}>
      <h2 className={`text-2xl font-semibold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Batak Domination</h2>
      <div className="mt-6 w-full">
        <iframe 
          className={`w-full aspect-square rounded-lg ${isDark ? 'border border-dark-border' : ''}`}
          style={{ border: isDark ? '1px solid #1a2340' : '1px solid rgba(0, 0, 0, 0.1)' }} 
          src="https://embed.figma.com/proto/dtkPcMZw82FhYxeOVNOKq2/Untitled?node-id=61-6&scaling=contain&page-id=0%3A1&starting-point-node-id=61%3A6&embed-host=share" 
          allowFullScreen
        ></iframe>
      </div>
      <div id="batak-data-content" className="mt-4">
        {/* Batak data content will be loaded here by JS later */}
      </div>
    </div>
  );
} 
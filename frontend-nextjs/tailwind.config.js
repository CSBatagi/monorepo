/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#080c14',
          surface: '#0d1321',
          card: '#111827',
          border: '#1a2340',
          hover: '#1e293b',
          'row-alt': '#182030',
          line: '#374151',
          accent: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
} 
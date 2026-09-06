import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/styles/table-styles.css";
import "@/styles/club-design.css";
import "@/styles/club-versions.css";
import "@/styles/cinematic.css";
import "@/styles/cinematic-3d.css";
import Providers from "@/components/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CS Batağı",
  description: "CS Batağı — katılım, takım seçimi, ligler ve Counter-Strike maç istatistikleri.",
  manifest: "/manifest.json",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" data-design="modern" data-club-version="original" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var d=new URLSearchParams(location.search).get('ui')||localStorage.getItem('cs-batagi-design')||'modern';d=['classic','cinematic'].includes(d)?d:'modern';document.documentElement.dataset.design=d;var v=localStorage.getItem('cs-batagi-club-version');document.documentElement.dataset.clubVersion=['original','panels','warm','graphite'].includes(v)?v:'original';var t=d==='cinematic'?'dark':localStorage.getItem(d==='classic'?'cs-batagi-theme':'cs-batagi-modern-theme')||(d==='classic'?'light':'dark');document.documentElement.classList.toggle('dark',t==='dark')}catch(e){document.documentElement.classList.add('dark')}})();` }} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

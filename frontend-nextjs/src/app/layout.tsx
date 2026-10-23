import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/styles/table-styles.css";
import "@/styles/club-design.css";
import "@/styles/club-versions.css";
import "@/styles/cinematic.css";
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
    <html lang="tr" data-design="modern" data-club-version="warm-graphite" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var d=new URLSearchParams(location.search).get('ui')||localStorage.getItem('cs-batagi-design')||'modern';d=d==='classic'?'boomer':['boomer','cinematic'].includes(d)?d:'modern';var b=d==='boomer';document.documentElement.dataset.design=b?'modern':d;document.documentElement.dataset.edition=b?'boomer':'';document.documentElement.dataset.clubVersion='warm-graphite';var t=d==='cinematic'?'dark':localStorage.getItem(b?'cs-batagi-boomer-theme':'cs-batagi-modern-theme')||(b?'light':'dark');document.documentElement.classList.toggle('dark',t==='dark')}catch(e){document.documentElement.classList.add('dark')}})();` }} />
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

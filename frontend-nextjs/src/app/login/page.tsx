"use client";

import React, { Suspense } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";



const ERROR_MESSAGES: Record<string, string> = {
  steam_required: "Artık Steam hesabınla giriş yapabilirsin.",
  steam_login: "Steam girişi tamamlanamadı. Lütfen tekrar dene.",
  not_member: "Bu Steam hesabı oyuncu listemizde yok. Katılmak için bir yöneticiyle iletişime geç.",
  account_unavailable: "Hesabın şu anda yüklenemiyor. Biraz sonra tekrar dene.",
  server_config: "Giriş hizmeti yapılandırılmamış. Yöneticiyle iletişime geç.",
};

function LoginPageInner() {
  const { isDark, design } = useTheme();
  const params = useSearchParams();
  const nextParam = params.get("next") || "/";
  const errorCode = params.get("error");

  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] || `Hata: ${errorCode}` : null;

  const handleSteamLogin = () => {
    window.location.href = '/api/auth/steam?' + new URLSearchParams({ next: nextParam });
  };

  return (
    <div className={`${design === "modern" ? "club-login" : design === "cinematic" ? "cinema-login-page" : ""} min-h-screen flex items-center justify-center p-6 ${isDark ? 'bg-dark-bg' : 'bg-gray-50'}`}>
      {design === 'modern' && <div className="club-login-story">
        <div className="club-brand"><Image src="/images/BatakLogo192.png" width={44} height={44} alt="" /><span>CS BATAĞI<small>COUNTER-STRIKE KULÜBÜ</small></span></div>
        <h2>Aynı ekip.<br />Yeni bir <span>gece.</span></h2>
        <p>Katılımını bildir, takımını kur, maçlarını takip et. Ekibin burada.</p>
        <small>COUNTER-STRIKE 2 / CS BATAĞI</small>
      </div>}
      <div className={`${design === "modern" ? "club-login-form" : ""} w-full max-w-md rounded-xl shadow-md p-6 ${isDark ? 'bg-dark-surface border border-dark-border' : 'bg-white'}`}>
        <h1 className={`text-2xl font-semibold text-center mb-4 ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
          {design === "modern" ? "Kulübe hoş geldin." : "CS Batagi - Giris"}
        </h1>
        <p className={`text-center text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          {design === "modern" ? "Devam etmek için Steam hesabınla giriş yap." : "Giris yapinca tum sayfalara erisebileceksiniz."}
        </p>

        {errorMessage && (
          <div className={`mb-4 p-3 rounded-md text-sm ${isDark ? 'bg-red-900/30 border border-red-800/50 text-red-300' : 'bg-red-100 border border-red-400 text-red-700'}`}>
            {errorMessage}
          </div>
        )}

        <button
          onClick={handleSteamLogin}
          className={`w-full flex items-center justify-center gap-3 border rounded-md py-3 text-base font-medium transition-colors ${
            isDark
              ? 'border-dark-border hover:bg-dark-card text-gray-200'
              : 'border-gray-300 hover:bg-gray-100'
          }`}
        >
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="16" cy="8" r="5" /><circle cx="16" cy="8" r="2.5" /><circle cx="7" cy="17" r="3" /><path d="m9 15 3-4m-2 7 6-5M1 14l5 3" /></svg>
          <span>Steam ile giriş yap</span>
        </button>

        <p className="text-xs text-center mt-3 text-gray-500">
          Bu cihazda 30 gün girişin açık kalır. Siteyi kullandıkça bu süre otomatik uzar.
        </p>

        <p className={`text-xs text-center mt-6 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          {design === "modern" ? "Katılım · Takım seçimi · Maç istatistikleri" : `Giristen sonra yonlendirileceginiz yer: ${nextParam}`}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6">Yukleniyor...</div>}>
      <LoginPageInner />
    </Suspense>
  );
}

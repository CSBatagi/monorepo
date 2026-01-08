'use client';

import React, { useState } from 'react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/contexts/AuthContext';

export default function NotificationSettings() {
  const { user } = useAuth();
  const {
    isSupported,
    isSubscribed,
    isLoading,
    error,
    permission,
    preferences,
    prefsLoading,
    subscribe,
    unsubscribe,
    updatePreferences
  } = usePushNotifications();

  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Detect iOS
  const isIOS = typeof navigator !== 'undefined' && 
    /iPad|iPhone|iPod/.test(navigator.userAgent) && 
    !(window as any).MSStream;
  
  // Detect if running as PWA (standalone)
  const isPWA = typeof window !== 'undefined' && 
    (window.matchMedia('(display-mode: standalone)').matches || 
     (window.navigator as any).standalone === true);

  if (!user) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-2">🔔 Bildirimler</h3>
        <p className="text-slate-400 text-sm">
          Bildirimleri etkinleştirmek için giriş yapmalısınız.
        </p>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-2">🔔 Bildirimler</h3>
        <p className="text-slate-400 text-sm">
          Bu tarayıcı push bildirimlerini desteklemiyor.
        </p>
      </div>
    );
  }

  // iOS requires PWA installation for push
  if (isIOS && !isPWA) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-2">🔔 Bildirimler</h3>
        <p className="text-slate-400 text-sm mb-3">
          iPhone/iPad&apos;de bildirim almak için uygulamayı ana ekrana eklemeniz gerekiyor.
        </p>
        
        <button
          onClick={() => setShowIOSGuide(!showIOSGuide)}
          className="text-blue-400 text-sm underline hover:text-blue-300"
        >
          {showIOSGuide ? 'Gizle' : 'Nasıl yapılır?'}
        </button>
        
        {showIOSGuide && (
          <div className="mt-3 bg-slate-700 rounded p-3 text-sm text-slate-300">
            <ol className="list-decimal list-inside space-y-2">
              <li>Safari&apos;de bu sayfayı açın</li>
              <li>Alt kısımdaki <span className="text-blue-400">Paylaş</span> (📤) butonuna tıklayın</li>
              <li><span className="text-blue-400">&quot;Ana Ekrana Ekle&quot;</span> seçeneğini seçin</li>
              <li>Eklenen uygulamayı açın ve buraya geri dönün</li>
            </ol>
          </div>
        )}
      </div>
    );
  }

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  const handlePrefChange = async (key: keyof typeof preferences) => {
    await updatePreferences({ [key]: !preferences[key] });
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h3 className="text-lg font-semibold text-white mb-3">🔔 Bildirimler</h3>
      
      {/* Main toggle */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-white font-medium">Push Bildirimleri</p>
          <p className="text-slate-400 text-sm">
            {isSubscribed ? 'Bildirimler açık' : 'Bildirimler kapalı'}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isSubscribed ? 'bg-blue-600' : 'bg-slate-600'
          } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isSubscribed ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded p-2 mb-3">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {permission === 'denied' && (
        <div className="bg-yellow-900/50 border border-yellow-700 rounded p-2 mb-3">
          <p className="text-yellow-300 text-sm">
            Bildirim izni reddedildi. Tarayıcı ayarlarından izin vermeniz gerekiyor.
          </p>
        </div>
      )}

      {/* Preference toggles - only show when subscribed */}
      {isSubscribed && (
        <div className="border-t border-slate-700 pt-3 mt-3">
          <p className="text-slate-400 text-sm mb-3">Hangi bildirimleri almak istiyorsun?</p>
          
          <div className="space-y-3">
            <PreferenceToggle
              label="Maç günü hatırlatması"
              description="Bugün maç var, durumunu bildir"
              checked={preferences.matchDay}
              onChange={() => handlePrefChange('matchDay')}
              disabled={prefsLoading}
            />
            <PreferenceToggle
              label="Yeni istatistikler"
              description="Maç sonrası yeni istatistikler yayınlandığında"
              checked={preferences.stats}
              onChange={() => handlePrefChange('stats')}
              disabled={prefsLoading}
            />
            <PreferenceToggle
              label="Ödüller ve MVP"
              description="Aylık ödüller ve maçın MVP'si"
              checked={preferences.awards}
              onChange={() => handlePrefChange('awards')}
              disabled={prefsLoading}
            />
            <PreferenceToggle
              label="Teker döndü!"
              description="10 kişi olduğunda bildirim"
              checked={preferences.tekerDondu}
              onChange={() => handlePrefChange('tekerDondu')}
              disabled={prefsLoading}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface PreferenceToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function PreferenceToggle({ label, description, checked, onChange, disabled }: PreferenceToggleProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex-1 mr-3">
        <p className="text-white text-sm">{label}</p>
        <p className="text-slate-500 text-xs">{description}</p>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-slate-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

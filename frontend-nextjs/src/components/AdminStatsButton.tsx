'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '@/lib/firebase';

export default function AdminStatsButton() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  // Check admin status from Firebase Realtime Database
  useEffect(() => {
    async function checkAdminStatus() {
      if (!user) {
        setIsAdmin(false);
        setCheckingAdmin(false);
        return;
      }

      try {
        // Check if user's UID is in /admins/{uid} node
        const adminRef = ref(db, `admins/${user.uid}`);
        const snapshot = await get(adminRef);
        setIsAdmin(snapshot.exists() && snapshot.val() === true);
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
      } finally {
        setCheckingAdmin(false);
      }
    }

    checkAdminStatus();
  }, [user]);

  // Don't show anything while checking or if not admin
  if (checkingAdmin || !isAdmin) return null;

  const handleRegenerateStats = async () => {
    if (!confirm('İstatistikleri yeniden oluşturmak istediğinize emin misiniz?')) {
      return;
    }

    setLoading(true);
    setMessage('⏳ Veritabanından istatistikler çekiliyor...');

    try {
      // Get Firebase ID token for server-side admin verification
      const idToken = await user!.getIdToken();
      const response = await fetch('/api/admin/regenerate-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        const filesWritten = data.filesWritten?.length || 0;
        setMessage(`✅ ${filesWritten} dosya güncellendi! Sayfa yenileniyor...`);
        // Reload page after 2 seconds to show updated stats
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setMessage(`❌ Hata: ${data.error || 'Bilinmeyen hata'}\n${data.details || ''}`);
      }
    } catch (error) {
      setMessage('❌ Bağlantı hatası - backend çalışıyor mu?');
      console.error('Stats regeneration error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={handleRegenerateStats}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 text-white rounded-lg shadow-lg transition-colors font-medium text-sm"
        title="Admin: İstatistikleri Yeniden Oluştur"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Yenileniyor...</span>
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            <span>Stat Bas</span>
          </>
        )}
      </button>
      {message && (
        <div className="mt-2 px-4 py-2 bg-gray-800 text-white rounded-lg shadow-lg text-sm">
          {message}
        </div>
      )}
    </div>
  );
}

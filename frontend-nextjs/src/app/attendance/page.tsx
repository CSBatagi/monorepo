'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Player } from '@/types';
import { db, auth as firebaseAuth } from '@/lib/firebase'; // Firebase db and auth instances
import { ref, onValue, off, update, set } from 'firebase/database';
import EmojiControls from '@/components/Attendance/EmojiControls';
import AttendanceControls from '@/components/Attendance/AttendanceControls';
import InfoPanel from '@/components/Attendance/InfoPanel';

// Constants from original attendance.js
const ATTENDANCE_DB_PATH = 'attendanceState';
const EMOJI_DB_PATH = 'emojiState';
const TEAM_PICKER_DB_PATH = 'teamPickerState'; // For clearing
const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
const CLEAR_ATTENDANCE_PASSWORD = process.env.NEXT_PUBLIC_CLEAR_ATTENDANCE_PASSWORD || "osirikler"; // Default if not in env

const ATTENDANCE_STATES = ["not_coming", "no_response", "coming"];
const EMOJI_STATES = [
    "normal", "tired", "sick", "feeling_good", "waffle",
    "cocuk_bende", "evde_degil", "sonrakine", "kafa_izni",
    "hanimpoints", "sikimin_keyfi", "dokuzda_haber"
];
const EMOJI_MAPPING: { [key: string]: string } = {
    "normal": "😊", "tired": "😴", "sick": "🤒", "feeling_good": "🔥",
    "waffle": "🧇", "cocuk_bende": "👶", "evde_degil": "🛄", "sonrakine": "🔜",
    "kafa_izni": "💆‍♂️", "hanimpoints": "🙅‍♀️", "sikimin_keyfi": "🍆", "dokuzda_haber": "9️⃣"
};
const EMOJI_EXPLANATIONS: { [key: string]: string } = {
    "normal": "Normal", "tired": "Yorgun", "sick": "Hasta", "feeling_good": "İyi hissediyorum",
    "waffle": "Waffle", "cocuk_bende": "Çocuk bende / hasta", "evde_degil": "Evde değil",
    "sonrakine": "Bi sonraki maça geliyorum", "kafa_izni": "Kafa izni",
    "hanimpoints": "Not enough hanımpoints", "sikimin_keyfi": "Sikimin keyfine, size mi soracağım götelekler",
    "dokuzda_haber": "9'da kalirsaniz haber edin"
};
const TEKER_DONDU_THRESHOLD = 10;

interface FirebaseAttendanceData {
  [steamId: string]: { name?: string; status: string; };
}
interface FirebaseEmojiData {
  [steamId: string]: { name?: string; status: string; };
}

export default function AttendancePage() {
  const { user, loading: authLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [firebaseAttendance, setFirebaseAttendance] = useState<FirebaseAttendanceData>({});
  const [firebaseEmojis, setFirebaseEmojis] = useState<FirebaseEmojiData>({});
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [loadingFirebaseData, setLoadingFirebaseData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState<{[key: string]: boolean}>({}); // For individual player updates
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        setLoadingPlayers(true);
        const response = await fetch('/data/players.json?_cb=' + Date.now());
        if (!response.ok) throw new Error(`Failed to fetch players.json: ${response.statusText}`);
        const data: Player[] = await response.json();
        setPlayers(data);
      } catch (error) {
        console.error("Error fetching players.json:", error);
      } finally {
        setLoadingPlayers(false);
      }
    };
    fetchPlayers();
  }, []);

  // Firebase listeners
  useEffect(() => {
    if (!user || players.length === 0) {
      if (!user && !authLoading) setLoadingFirebaseData(false); // Not logged in, so no data to load from Firebase
      return;
    }
    setLoadingFirebaseData(true);

    const attendanceRef = ref(db, ATTENDANCE_DB_PATH);
    const emojiRef = ref(db, EMOJI_DB_PATH);

    const onAttendanceValue = onValue(attendanceRef, (snapshot) => {
      setFirebaseAttendance(snapshot.val() || {});
      setLoadingFirebaseData(false); // Consider combined loading state later
    }, (error) => {
      console.error("Firebase attendance listener error:", error);
      setLoadingFirebaseData(false);
    });

    const onEmojiValue = onValue(emojiRef, (snapshot) => {
      setFirebaseEmojis(snapshot.val() || {});
      // setLoadingFirebaseData(false); // Already handled by attendance or use combined
    }, (error) => {
      console.error("Firebase emoji listener error:", error);
    });

    return () => {
      off(attendanceRef, 'value', onAttendanceValue);
      off(emojiRef, 'value', onEmojiValue);
    };
  }, [user, players.length, authLoading]); // Depend on user and players list

  // Initialize emoji statuses in Firebase
  const initializeEmojiStatuses = useCallback(async () => {
    if (!user || players.length === 0 || Object.keys(firebaseEmojis).length === 0 || loadingFirebaseData) return;

    const updates: { [key: string]: any } = {};
    let needsSync = false;

    players.forEach(player => {
      if (player.steamId && (!firebaseEmojis[player.steamId] || firebaseEmojis[player.steamId].name !== player.name)) {
        updates[`${EMOJI_DB_PATH}/${player.steamId}`] = { name: player.name, status: firebaseEmojis[player.steamId]?.status || 'normal' };
        needsSync = true;
      }
    });

    if (needsSync) {
      try {
        await update(ref(db), updates);
        console.log("Initial/missing emoji states synced to Firebase");
      } catch (error) {
        console.error("Failed to sync initial emoji states:", error);
      }
    }
  }, [user, players, firebaseEmojis, loadingFirebaseData]);

  useEffect(() => {
    // Run emoji initialization once Firebase Emojis are loaded for the first time
    // and we have players. This ensures we don't run it before knowing what's in Firebase.
    if (!loadingFirebaseData && Object.keys(firebaseEmojis).length > 0 && players.length > 0) {
        initializeEmojiStatuses();
    }
  }, [loadingFirebaseData, firebaseEmojis, players, initializeEmojiStatuses]);

  const handleAttendanceChange = async (player: Player, newAttendance: string) => {
    if (!firebaseAuth.currentUser) {
      alert("You must be logged in to change status."); return;
    }
    setIsSubmitting(prev => ({ ...prev, [player.steamId]: true }));
    try {
      const attendanceUpdatePath = `${ATTENDANCE_DB_PATH}/${player.steamId}`;
      await set(ref(db, attendanceUpdatePath), { name: player.name, status: newAttendance });
      if (APPS_SCRIPT_URL) {
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steamId: player.steamId, attendance: newAttendance }),
          mode: 'no-cors' // Changed from redirect:follow due to potential CORS issues with Apps Script
        }).catch(err => console.error("Error sending sheet update:", err)); // Log but don't block UI
      }
    } catch (error) {
      console.error("Error syncing attendance:", error);
      alert("Failed to update attendance. Please try again.");
    } finally {
      setIsSubmitting(prev => ({ ...prev, [player.steamId]: false }));
    }
  };

  const handleEmojiChange = async (player: Player, newEmoji: string) => {
    if (!firebaseAuth.currentUser) {
      alert("You must be logged in to change status."); return;
    }
    setIsSubmitting(prev => ({ ...prev, [player.steamId]: true }));
    try {
      const emojiUpdatePath = `${EMOJI_DB_PATH}/${player.steamId}`;
      await set(ref(db, emojiUpdatePath), { name: player.name, status: newEmoji });
    } catch (error) {
      console.error("Error syncing emoji:", error);
      alert("Failed to update emoji. Please try again.");
    } finally {
      setIsSubmitting(prev => ({ ...prev, [player.steamId]: false }));
    }
  };

  const handleClearAttendance = async () => {
    if (!firebaseAuth.currentUser) { alert("You must be logged in to clear attendance."); return; }
    const password = prompt("Please enter the password to clear attendance:");
    if (password === null) return; // User cancelled
    if (password !== CLEAR_ATTENDANCE_PASSWORD) { alert("Incorrect password."); return; }
    if (!confirm('Emin misiniz? Bu işlem tüm katılım durumlarını sıfırlayacak ve takım seçimi verilerini temizleyecektir.')) return;

    setIsClearing(true);
    try {
      if (players.length === 0) {
        alert("Player list not loaded. Cannot clear."); return;
      }

      const firebaseTotalUpdates: { [key: string]: any } = {};
      const sheetUpdatePromises: Promise<any>[] = [];

      players.forEach(player => {
        const targetAttendance = (player.status || '').trim().toLowerCase() === 'adam evde yok' ? 'not_coming' : 'no_response';
        firebaseTotalUpdates[`${ATTENDANCE_DB_PATH}/${player.steamId}`] = { name: player.name, status: targetAttendance };
        firebaseTotalUpdates[`${EMOJI_DB_PATH}/${player.steamId}`] = { name: player.name, status: 'normal' };
        if (APPS_SCRIPT_URL && firebaseAttendance[player.steamId]?.status !== targetAttendance) {
          sheetUpdatePromises.push(
            fetch(APPS_SCRIPT_URL, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ steamId: player.steamId, attendance: targetAttendance }), mode: 'no-cors'
            }).catch(err => console.error(`Sheet update failed for ${player.steamId} during clear:`, err))
          );
        }
      });
      
      // Team Picker Resets
      firebaseTotalUpdates[`${TEAM_PICKER_DB_PATH}/teamA/kabile`] = "";
      firebaseTotalUpdates[`${TEAM_PICKER_DB_PATH}/teamB/kabile`] = "";
      for (let i = 1; i <= 3; i++) {
        firebaseTotalUpdates[`${TEAM_PICKER_DB_PATH}/maps/map${i}/mapName`] = "";
        firebaseTotalUpdates[`${TEAM_PICKER_DB_PATH}/maps/map${i}/t_team`] = "";
        firebaseTotalUpdates[`${TEAM_PICKER_DB_PATH}/maps/map${i}/ct_team`] = "";
      }

      await update(ref(db), firebaseTotalUpdates);
      await Promise.all(sheetUpdatePromises);
      alert("Attendance cleared successfully!");
    } catch (error) {
      console.error("Error clearing attendance:", error);
      alert("Failed to clear attendance. See console for details.");
    } finally {
      setIsClearing(false);
    }
  };

  if (authLoading || loadingPlayers) {
    return <div className="text-center py-10">Loading page data...</div>;
  }

  if (!user) {
    return (
      <div className="text-center py-10">
        <p className="text-xl font-semibold text-gray-700">Please sign in to view attendance.</p>
      </div>
    );
  }

  const getCombinedPlayerData = () => {
    const combined = players.map(p => ({
      ...p,
      attendanceStatus: firebaseAttendance[p.steamId]?.status || 'no_response',
      currentEmoji: firebaseEmojis[p.steamId]?.status || 'normal',
    }));

    // Sort players: 'Adam Evde Yok' at the bottom, rest sorted by name
    combined.sort((a, b) => {
      const aIsInactive = a.status === 'Adam Evde Yok';
      const bIsInactive = b.status === 'Adam Evde Yok';

      if (aIsInactive && !bIsInactive) return 1;
      if (!aIsInactive && bIsInactive) return -1;
      
      // Both are active or both are inactive, sort by name
      return a.name.localeCompare(b.name);
    });

    return combined;
  };

  const combinedPlayers = getCombinedPlayerData();
  const comingCount = combinedPlayers.filter(p => p.attendanceStatus === 'coming').length;
  const noResponseCount = combinedPlayers.filter(p => p.attendanceStatus === 'no_response').length;
  const tekerDondu = comingCount >= TEKER_DONDU_THRESHOLD;

  // TODO: Implement Clear Attendance functionality

  return (
    <div id="page-attendance" className="w-full max-w-none p-3 sm:p-4 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0 lg:max-w-3xl">
          <h2 className="text-xl sm:text-2xl font-semibold text-blue-600 mb-3 sm:mb-4">Katılım Durumu</h2>
          
          <div className={`p-3 mb-3 sm:mb-4 border rounded-lg shadow-sm text-sm ${tekerDondu ? 'bg-green-100 border-green-300' : comingCount < TEKER_DONDU_THRESHOLD ? 'bg-red-100 border-red-300' : 'bg-yellow-50 border-yellow-200'}`}>
            <p className="font-medium">
              Gelen Oyuncu: <span className={`font-bold ${tekerDondu ? 'text-green-700' : comingCount < TEKER_DONDU_THRESHOLD ? 'text-red-700' : 'text-orange-600'}`}>{comingCount}</span>
              <span className="mx-2">|</span>
              Belirsiz: <span className="font-bold text-orange-600">{noResponseCount}</span>
            </p>
            {tekerDondu && (
              <p id="teker-dondu-indicator" className="text-sm font-semibold text-green-700 mt-1 flex items-center">
                TEKER DÖNDÜ! 
                <span className="wheel-spinner ml-2" title="Teker Döndü!">
                  <svg 
                    height="20px" width="20px" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="currentColor">
                    <g>
                      <path d="M498.842,256c0-1.092-0.065-2.169-0.08-3.277c4.418-1.182,8.836-2.436,13.238-3.739 c-0.348-12.057-1.489-24.098-3.52-36.002c-4.556-0.445-9.136-0.809-13.708-1.124c-3.318-18.046-8.594-35.411-15.666-51.838 c3.609-2.768,7.186-5.632,10.762-8.529c-4.96-11.013-10.657-21.687-17.099-31.882c-4.369,1.343-8.731,2.767-13.085,4.232 c-9.913-15.253-21.476-29.318-34.463-41.941c2.274-3.965,4.636-7.858,6.821-11.896c-8.764-8.286-18.11-15.949-27.934-22.957 c-3.544,2.929-6.886,6.004-10.325,8.999c-14.841-10.254-30.904-18.871-47.889-25.628c0.599-4.548,1.125-9.112,1.594-13.676 c-11.272-4.322-22.884-7.818-34.65-10.504c-2.153,4.079-4.224,8.133-6.24,12.219c-16.33-3.456-33.25-5.308-50.599-5.308 c-1.158,0-2.29,0.065-3.447,0.097C251.355,8.82,250.279,4.394,248.968,0c-12.041,0.348-24.082,1.489-35.985,3.52 c-0.445,4.564-0.81,9.127-1.125,13.708c-18.069,3.318-35.41,8.594-51.837,15.65c-2.792-3.601-5.632-7.178-8.529-10.746 c-11.013,4.952-21.678,10.649-31.883,17.099c1.343,4.369,2.768,8.731,4.232,13.085C108.596,62.22,94.516,73.792,81.9,86.779 c-3.965-2.282-7.857-4.653-11.895-6.821c-8.286,8.755-15.949,18.102-22.957,27.934c2.921,3.544,6.004,6.894,8.998,10.342 c-10.252,14.841-18.87,30.871-25.635,47.864c-4.54-0.574-9.096-1.108-13.652-1.578c-4.337,11.297-7.833,22.876-10.52,34.634 c4.078,2.152,8.14,4.232,12.227,6.247c-3.464,16.33-5.316,33.25-5.316,50.599c0,1.092,0.064,2.193,0.072,3.277 c-4.402,1.182-8.828,2.428-13.222,3.754c0.348,12.033,1.482,24.074,3.513,35.977c4.556,0.438,9.135,0.818,13.715,1.134 c3.318,18.045,8.594,35.41,15.65,51.837c-3.601,2.776-7.17,5.624-10.746,8.521c4.944,11.03,10.641,21.695,17.098,31.891 c4.37-1.336,8.731-2.744,13.069-4.233c9.92,15.27,21.492,29.302,34.48,41.942c-2.282,3.965-4.653,7.848-6.821,11.878 c8.747,8.303,18.101,15.974,27.934,22.974c3.544-2.937,6.886-6.012,10.325-9.006c14.841,10.252,30.888,18.878,47.881,25.643 c-0.591,4.556-1.134,9.112-1.586,13.676c11.272,4.322,22.876,7.809,34.65,10.496c2.136-4.078,4.224-8.149,6.238-12.227 c16.33,3.464,33.25,5.309,50.6,5.309c1.157,0,2.29-0.065,3.439-0.073c1.206,4.402,2.266,8.828,3.577,13.23 c12.041-0.347,24.09-1.481,35.985-3.512c0.445-4.564,0.825-9.136,1.141-13.716c18.046-3.317,35.412-8.577,51.838-15.666 c2.768,3.617,5.616,7.186,8.512,10.762c11.03-4.944,21.687-10.648,31.899-17.098c-1.335-4.362-2.743-8.731-4.232-13.085 c15.245-9.913,29.326-21.469,41.941-34.464c3.965,2.29,7.85,4.644,11.888,6.821c8.294-8.764,15.965-18.101,22.957-27.934 c-2.937-3.544-5.996-6.886-8.99-10.326c10.252-14.841,18.846-30.895,25.636-47.889c4.556,0.599,9.112,1.117,13.667,1.57 c4.321-11.248,7.801-22.86,10.504-34.626c-4.079-2.136-8.149-4.224-12.228-6.238C496.998,290.27,498.842,273.357,498.842,256z M256,410.793c-85.501,0-154.809-69.292-154.809-154.793c0-85.5,69.308-154.8,154.809-154.8c85.484,0,154.809,69.3,154.809,154.8 C410.809,341.501,341.485,410.793,256,410.793z"/>
                      <path d="M256,270.962c8.262,0,14.962-6.692,14.962-14.962c0-8.27-6.7-14.97-14.962-14.97 c-8.278,0-14.978,6.7-14.978,14.97C241.022,264.27,247.722,270.962,256,270.962z"/>
                      <path d="M156.136,199.687c1.044,2.808,3.31,4.977,6.15,5.907l53.367,17.342c4.968,1.602,10.406,0.752,14.623-2.323 c4.232-3.075,6.724-7.979,6.724-13.206v-56.062c0-2.994-1.376-5.826-3.714-7.671c-2.347-1.861-5.406-2.541-8.327-1.861 c0,0,0.802-0.606-4.588,1.085c-25.191,7.938-46.756,24.042-61.572,45.218c-3.035,4.354-1.861,3.107-1.861,3.107 C155.384,193.772,155.092,196.887,156.136,199.687z"/>
                      <path d="M214.391,269.53c-1.61-4.977-5.51-8.877-10.463-10.479l-53.327-17.325c-2.865-0.931-5.956-0.494-8.448,1.157 c-2.5,1.659-4.094,4.369-4.329,7.347c0,0-0.34-0.946-0.388,4.71c-0.251,26.396,8.407,51.878,23.96,72.52 c3.204,4.241,2.379,2.744,2.379,2.744c1.95,2.25,4.823,3.496,7.801,3.374c2.994-0.13,5.762-1.602,7.517-4.03l32.967-45.396 C215.152,279.936,216.001,274.482,214.391,269.53z"/>
                      <path d="M269.198,306.47c-3.074-4.216-7.978-6.716-13.198-6.716c-5.22,0-10.123,2.5-13.206,6.716l-32.943,45.356 c-1.764,2.42-2.314,5.51-1.513,8.399c0.818,2.889,2.889,5.228,5.656,6.393c0,0-1.011,0.025,4.346,1.82 c25.044,8.392,51.951,8.028,76.388-0.396c5.025-1.724,3.334-1.4,3.334-1.4c2.752-1.158,4.823-3.512,5.616-6.385 c0.817-2.889,0.251-5.98-1.506-8.392L269.198,306.47z"/>
                      <path d="M361.448,241.709l-53.375,17.342c-4.952,1.602-8.853,5.502-10.471,10.479 c-1.611,4.953-0.752,10.407,2.323,14.614l32.958,45.356c1.748,2.436,4.515,3.893,7.509,4.038c2.995,0.122,5.868-1.141,7.826-3.406 c0,0-0.283,0.963,3.084-3.576c15.706-21.218,23.685-46.934,23.224-72.764c-0.089-5.3-0.307-3.593-0.307-3.593 c-0.235-2.986-1.846-5.697-4.338-7.348C367.395,241.216,364.28,240.779,361.448,241.709z"/>
                      <path d="M281.708,220.613c4.233,3.059,9.67,3.924,14.63,2.323l53.327-17.342c2.848-0.922,5.114-3.099,6.15-5.907 c1.036-2.8,0.744-5.923-0.818-8.488c0,0,0.834,0.567-2.452-4.03c-15.318-21.508-37.288-37.038-62.025-44.596 c-5.065-1.537-3.528-0.809-3.528-0.809c-2.905-0.68-5.956,0.008-8.31,1.877c-2.331,1.837-3.69,4.669-3.69,7.656v56.11 C274.984,212.634,277.492,217.538,281.708,220.613z"/>
                    </g>
                  </svg>     
                </span>
              </p>
            )}
          </div>

          <div className="mb-3 sm:mb-4">
            <button 
              id="clear-attendance-button" 
              onClick={handleClearAttendance}
              className="px-3 py-2 sm:px-4 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 disabled:opacity-50 flex items-center transition-colors"
              disabled={!user || isClearing || Object.values(isSubmitting).some(s => s) || loadingFirebaseData}
            >
              {isClearing && <span className="spinner-mini mr-2"></span>}
              Katılımı Temizle
            </button>
          </div>

          {(loadingFirebaseData && players.length > 0) && <p className="text-center py-5">Loading live attendance data...</p>}
          {!loadingFirebaseData && players.length === 0 && !loadingPlayers && (
            <p className="text-center py-5 text-gray-500">No players found. Check players.json.</p>
          )}
          {!loadingFirebaseData && players.length > 0 && (
            <div className="w-full">
              {/* Mobile: Compact Card Layout */}
              <div className="block md:hidden">
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-700">Oyuncu Durumu</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {combinedPlayers.map((player) => (
                      <div key={player.steamId} className={`px-3 py-3 ${player.status === 'Adam Evde Yok' ? 'bg-red-50 opacity-70' : 'bg-white'}`}>
                        <div className="flex items-start justify-between min-h-[40px]">
                          <div className="flex-1 min-w-0 mr-3 py-1">
                            <span className="font-medium text-sm text-gray-900 block truncate leading-tight">{player.name}</span>
                            {player.status === 'Adam Evde Yok' && (
                              <span className="text-xs text-red-600 bg-red-100 px-1.5 py-0.5 rounded mt-1 inline-block">Evde Yok</span>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-2 flex-shrink-0 h-10">
                            <div className="flex items-center justify-center h-full">
                              <EmojiControls 
                                player={player} 
                                currentEmoji={player.currentEmoji}
                                emojiStates={EMOJI_STATES}
                                emojiMapping={EMOJI_MAPPING}
                                emojiExplanations={EMOJI_EXPLANATIONS}
                                onEmojiChange={handleEmojiChange}
                                disabled={!user || isClearing || isSubmitting[player.steamId] || loadingFirebaseData}
                              />
                            </div>
                            <div className="flex items-center justify-center h-full">
                              <AttendanceControls 
                                player={player}
                                currentAttendance={player.attendanceStatus}
                                attendanceStates={ATTENDANCE_STATES}
                                onAttendanceChange={handleAttendanceChange}
                                disabled={!user || isClearing || isSubmitting[player.steamId] || loadingFirebaseData}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Desktop: Table Layout */}
              <div className="hidden md:block shadow-md rounded-lg w-full max-w-[800px] mx-auto overflow-x-auto">
                <table className="w-full text-base text-left text-gray-500 styled-table table-fixed">
                  <thead className="bg-gray-100">
                    <tr>
                      <th scope="col" className="px-2 py-1 text-left w-[33%]">Oyuncu</th>
                      <th scope="col" className="px-2 py-1 text-center whitespace-nowrap w-[33%]">Durum</th>
                      <th scope="col" className="px-2 py-1 text-center whitespace-nowrap w-[33%]">Katılım</th>
                    </tr>
                  </thead>
                  <tbody id="player-list">
                    {combinedPlayers.map((player) => (
                      <tr key={player.steamId} className={`border-b ${player.status === 'Adam Evde Yok' ? 'bg-red-50 opacity-70' : 'bg-white'} hover:bg-gray-50`}>
                        <td className="px-2 py-1 w-[33%]">
                          {player.status === 'Adam Evde Yok' ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-base text-gray-900 truncate">
                                {player.name}
                              </span>
                              <span className="text-xs text-red-600 bg-red-200 px-1 py-0.5 rounded-full whitespace-nowrap font-medium mt-1 self-start">
                                Evde Yok
                              </span>
                            </div>
                          ) : (
                            <span className="font-medium text-base text-gray-900 truncate">
                              {player.name}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-center w-[33%]">
                          <div className="flex items-center justify-center gap-1">
                            <EmojiControls 
                              player={player} 
                              currentEmoji={player.currentEmoji}
                              emojiStates={EMOJI_STATES}
                              emojiMapping={EMOJI_MAPPING}
                              emojiExplanations={EMOJI_EXPLANATIONS}
                              onEmojiChange={handleEmojiChange}
                              disabled={!user || isClearing || isSubmitting[player.steamId] || loadingFirebaseData}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1 text-center w-[33%]">
                          <div className="flex items-center justify-center gap-1">
                            <AttendanceControls 
                              player={player}
                              currentAttendance={player.attendanceStatus}
                              attendanceStates={ATTENDANCE_STATES}
                              onAttendanceChange={handleAttendanceChange}
                              disabled={!user || isClearing || isSubmitting[player.steamId] || loadingFirebaseData}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="lg:col-span-1 min-w-[320px]">
          <InfoPanel />
        </div>
      </div>
      <style jsx global>{`
        .spinner-mini {
          width: 16px;
          height: 16px;
          border: 2px solid transparent;
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
} 
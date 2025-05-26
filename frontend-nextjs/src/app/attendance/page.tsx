'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Player } from '@/types';
import { db, auth as firebaseAuth } from '@/lib/firebase'; // Firebase db and auth instances
import { ref, onValue, off, update, set } from 'firebase/database';
import EmojiControls from '@/components/Attendance/EmojiControls';
import AttendanceControls from '@/components/Attendance/AttendanceControls';

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
    return players.map(p => ({
      ...p,
      attendanceStatus: firebaseAttendance[p.steamId]?.status || 'no_response',
      currentEmoji: firebaseEmojis[p.steamId]?.status || 'normal',
    }));
  };

  const combinedPlayers = getCombinedPlayerData();
  const comingCount = combinedPlayers.filter(p => p.attendanceStatus === 'coming').length;
  const noResponseCount = combinedPlayers.filter(p => p.attendanceStatus === 'no_response').length;
  const tekerDondu = comingCount >= TEKER_DONDU_THRESHOLD;

  // TODO: Implement Clear Attendance functionality

  return (
    <div id="page-attendance" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Katılım Durumu</h2>
      
      <div className={`attendance-summary p-3 mb-4 border rounded-lg shadow-sm ${tekerDondu ? 'bg-green-100 border-green-300' : 'bg-yellow-50 border-yellow-200'}`}>
        <p className="text-sm font-medium">
          Gelen Oyuncu: <span className="font-bold text-green-700">{comingCount}</span>
          <span className="mx-2">|</span>
          Belirsiz: <span className="font-bold text-orange-600">{noResponseCount}</span>
        </p>
        {tekerDondu && (
          <p id="teker-dondu-indicator" className="text-sm font-semibold text-green-700 mt-1">TEKER DÖNDÜ! ✅</p>
        )}
      </div>

      <div className="mb-4">
        <button 
          id="clear-attendance-button" 
          onClick={handleClearAttendance}
          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 disabled:opacity-50 flex items-center"
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
        <div className="overflow-x-auto shadow-md rounded-lg">
          <table className="min-w-full text-sm text-left text-gray-500 styled-table">
            <thead className="text-xs text-gray-700 uppercase bg-gray-100">
              <tr>
                <th scope="col" className="px-6 py-3">Oyuncu</th>
                <th scope="col" className="px-6 py-3 text-center">Emoji</th>
                <th scope="col" className="px-6 py-3 text-center">Katılım</th>
              </tr>
            </thead>
            <tbody id="player-list">
              {combinedPlayers.map((player) => (
                <tr key={player.steamId} className={`border-b ${player.status === 'Adam Evde Yok' ? 'bg-red-50 opacity-70' : 'bg-white'}`}>
                  <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                    {player.name}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <EmojiControls 
                      player={player} 
                      currentEmoji={player.currentEmoji}
                      emojiStates={EMOJI_STATES}
                      emojiMapping={EMOJI_MAPPING}
                      emojiExplanations={EMOJI_EXPLANATIONS}
                      onEmojiChange={handleEmojiChange}
                      disabled={!user || isClearing || isSubmitting[player.steamId] || loadingFirebaseData}
                    />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <AttendanceControls 
                      player={player}
                      currentAttendance={player.attendanceStatus}
                      attendanceStates={ATTENDANCE_STATES}
                      onAttendanceChange={handleAttendanceChange}
                      disabled={!user || isClearing || isSubmitting[player.steamId] || loadingFirebaseData}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
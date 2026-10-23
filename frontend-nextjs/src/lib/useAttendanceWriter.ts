'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { updateAttendance } from '@/lib/liveApi';

const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

/**
 * Writes one player's attendance status with the side effects every entry point
 * shares: captaincy is dropped when not coming, the sheet is mirrored and the
 * "teker döndü" notification is (re)evaluated.
 */
export function useAttendanceWriter() {
  const { user } = useSession();
  const tekerFollowUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitTekerDonduIfNeeded = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ topic: 'teker_dondu_reached' }),
      });
      if (res.ok) {
        const json = await res.json() as { skipped?: boolean; reason?: string; settlesAt?: number };
        if (json.skipped && json.reason === 'settle_pending' && json.settlesAt) {
          const delayMs = Math.max(json.settlesAt - Date.now(), 0) + 250;
          if (tekerFollowUpTimerRef.current) clearTimeout(tekerFollowUpTimerRef.current);
          tekerFollowUpTimerRef.current = setTimeout(() => {
            tekerFollowUpTimerRef.current = null;
            void emitTekerDonduIfNeeded();
          }, delayMs);
        }
      }
    } catch (error) {
      console.warn('Failed to emit teker_dondu notification event', error);
    }
  }, [user]);

  useEffect(() => () => {
    if (tekerFollowUpTimerRef.current) clearTimeout(tekerFollowUpTimerRef.current);
  }, []);

  return useCallback(async (steamId: string, name: string, status: string) => {
    const fields: { status: string; is_kaptan?: boolean; kaptan_timestamp?: null } = { status };
    if (status !== 'coming') {
      fields.is_kaptan = false;
      fields.kaptan_timestamp = null;
    }
    await updateAttendance(steamId, name, fields);

    if (APPS_SCRIPT_URL) {
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId, attendance: status }),
        mode: 'no-cors'
      }).catch(err => console.error("Error sending sheet update:", err));
    }

    if (tekerFollowUpTimerRef.current) {
      clearTimeout(tekerFollowUpTimerRef.current);
      tekerFollowUpTimerRef.current = null;
    }
    void emitTekerDonduIfNeeded();
  }, [emitTekerDonduIfNeeded]);
}

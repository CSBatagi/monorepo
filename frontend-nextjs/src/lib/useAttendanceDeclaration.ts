'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { updateAttendance } from './liveApi';
import { attendanceFields, type AttendanceStatus } from './cinematicBriefing';

/** Same single-player write and notification contract as the attendance page. */
export function useAttendanceDeclaration(refetch: () => Promise<void>, preview = false) {
  const { user } = useSession();
  const followUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (followUp.current) clearTimeout(followUp.current); };
  }, [user?.uid]);

  const emit = useCallback(async function notify() {
    if (!user || !mounted.current) return;
    try {
      const res = await fetch('/api/notifications/emit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ topic: 'teker_dondu_reached' }) });
      if (!res.ok || !mounted.current) return;
      const json = await res.json() as { skipped?: boolean; reason?: string; settlesAt?: number };
      if (json.skipped && json.reason === 'settle_pending' && json.settlesAt && mounted.current) {
        if (followUp.current) clearTimeout(followUp.current);
        followUp.current = setTimeout(() => { followUp.current = null; void notify(); }, Math.max(json.settlesAt - Date.now(), 0) + 250);
      }
    } catch { /* Attendance was saved; optional notification retries are independent. */ }
  }, [user]);

  return useCallback(async (player: { steamId: string; name: string }, status: AttendanceStatus) => {
    if (!user) throw new Error('Katılımını yazmak için giriş yapmalısın.');
    await updateAttendance(player.steamId, player.name, attendanceFields(status));
    void refetch();
    // The explicitly labelled local fixture never sends sheet updates or pushes.
    if (preview) return;
    const sheet = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
    if (sheet) void fetch(sheet, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steamId: player.steamId, attendance: status }), mode: 'no-cors' }).catch(() => {});
    if (followUp.current) clearTimeout(followUp.current);
    void emit();
  }, [user, refetch, emit, preview]);
}

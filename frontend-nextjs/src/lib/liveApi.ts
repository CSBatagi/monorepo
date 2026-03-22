'use client';

/**
 * Helper for writing to /api/live/* endpoints.
 * Replaces Firebase RTDB set()/update() calls.
 */

export async function livePost(path: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`/api/live/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Attendance ---

export function updateAttendance(steamId: string, name: string, fields: {
  status?: string;
  emoji_status?: string;
  is_kaptan?: boolean;
  kaptan_timestamp?: number | null;
}) {
  return livePost('attendance', { steamId, name, ...fields });
}

export function bulkUpdateAttendance(players: Array<{
  steamId: string;
  name: string;
  status?: string;
  emoji_status?: string;
  is_kaptan?: boolean;
  kaptan_timestamp?: number | null;
}>) {
  return livePost('attendance/bulk', { players });
}

export function resetAttendance() {
  return livePost('attendance/reset', {});
}

// --- Team Picker ---

export function assignPlayer(steamId: string, team: 'A' | 'B', player: any) {
  return livePost('team-picker', { action: 'assign', steamId, team, player });
}

export function removePlayer(steamId: string, team: 'A' | 'B') {
  return livePost('team-picker', { action: 'remove', steamId, team });
}

export function updateTeamPicker(fields: Record<string, any>) {
  return livePost('team-picker', { action: 'update', ...fields });
}

export function updatePlayerOverride(steamId: string, stats: Record<string, number> | null) {
  return livePost('team-picker', { action: 'override', steamId, stats });
}

export function resetTeamPicker() {
  return livePost('team-picker', { action: 'reset' });
}

// --- MVP Votes ---

export function submitMvpVote(date: string, voterSteamId: string, votedForSteamId: string) {
  return livePost('mvp-votes', { action: 'vote', date, voterSteamId, votedForSteamId });
}

export function toggleMvpLock(date: string, lock: boolean, lockedByUid?: string, lockedByName?: string) {
  return livePost('mvp-votes', { action: 'lock', date, lock, lockedByUid, lockedByName });
}

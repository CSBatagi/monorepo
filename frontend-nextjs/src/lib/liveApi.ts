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

// --- Batak Captains ---

export function setCaptain(fields: {
  date: string;
  teamKey: string;
  steamId: string;
  steamName?: string;
  teamName?: string;
  setByUid?: string;
  setByName?: string;
  setAt?: number;
}) {
  return livePost('batak-captains', { action: 'set', ...fields });
}

// --- Super Kupa ---

export function setSuperKupaMatch(fields: {
  slot: string;
  player1SteamId: string;
  player1Name: string;
  player1League: string;
  player2SteamId: string;
  player2Name: string;
  player2League: string;
  winnerSteamId: string;
  score: string;
  date?: string;
  setByUid?: string;
  setByName?: string;
  setAt?: number;
}) {
  return livePost('batak-super-kupa', { action: 'set', ...fields });
}

export function deleteSuperKupaMatch(slot: string) {
  return livePost('batak-super-kupa', { action: 'delete', slot });
}

export function resetSuperKupa() {
  return livePost('batak-super-kupa', { action: 'reset' });
}

// --- Notification Preferences ---

export async function getNotificationPreferences(): Promise<{ enabled: boolean; topics: Record<string, boolean> }> {
  const res = await fetch('/api/notifications/preferences', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveNotificationPreferences(prefs: { enabled: boolean; topics: Record<string, boolean> }): Promise<void> {
  const res = await fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// --- Notification Subscriptions ---

export async function getDeviceRegistration(deviceId: string): Promise<{ registered: boolean; enabled?: boolean }> {
  const res = await fetch(`/api/notifications/subscriptions?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function registerDevice(params: {
  deviceId: string;
  token: string;
  platform: string;
  userAgent: string;
}): Promise<void> {
  const res = await fetch('/api/notifications/subscriptions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function unregisterDevice(deviceId: string): Promise<void> {
  const res = await fetch('/api/notifications/subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

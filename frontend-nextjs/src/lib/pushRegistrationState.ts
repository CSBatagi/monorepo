'use client';

export const DEVICE_ID_KEY = 'csbatagi_device_id';
const AUTO_PUSH_OPT_OUT_PREFIX = 'csbatagi_auto_push_opt_out_v1';

export function getOrCreateDeviceId(): string {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const nextId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  window.localStorage.setItem(DEVICE_ID_KEY, nextId);
  return nextId;
}

function getAutoPushOptOutKey(uid: string, deviceId: string): string {
  return `${AUTO_PUSH_OPT_OUT_PREFIX}:${uid}:${deviceId}`;
}

export function isAutoPushOptedOut(uid: string, deviceId: string): boolean {
  return window.localStorage.getItem(getAutoPushOptOutKey(uid, deviceId)) === '1';
}

export function setAutoPushOptOut(uid: string, deviceId: string, optedOut: boolean): void {
  const key = getAutoPushOptOutKey(uid, deviceId);
  if (optedOut) {
    window.localStorage.setItem(key, '1');
  } else {
    window.localStorage.removeItem(key);
  }
}

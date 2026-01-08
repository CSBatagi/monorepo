'use client';

import { useState, useEffect, useCallback } from 'react';
import { auth } from '@/lib/firebase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

interface PushSubscriptionState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
  permission: NotificationPermission | 'default';
  deviceId: string | null;
}

interface NotificationPrefs {
  matchDay: boolean;
  stats: boolean;
  awards: boolean;
  tekerDondu: boolean;
}

const defaultPrefs: NotificationPrefs = {
  matchDay: true,
  stats: true,
  awards: true,
  tekerDondu: true
};

// Convert base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Generate a simple device ID
function generateDeviceId(): string {
  const stored = localStorage.getItem('push_device_id');
  if (stored) return stored;
  
  const newId = 'dev_' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('push_device_id', newId);
  return newId;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushSubscriptionState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    error: null,
    permission: 'default',
    deviceId: null
  });
  
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
  const [prefsLoading, setPrefsLoading] = useState(false);

  // Check if push is supported
  useEffect(() => {
    const checkSupport = async () => {
      const isSupported = 'serviceWorker' in navigator && 
                          'PushManager' in window && 
                          'Notification' in window;
      
      if (!isSupported) {
        setState(prev => ({ 
          ...prev, 
          isSupported: false, 
          isLoading: false,
          error: 'Push notifications not supported in this browser'
        }));
        return;
      }

      const permission = Notification.permission;
      
      // Check existing subscription
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const deviceId = generateDeviceId();
        
        setState({
          isSupported: true,
          isSubscribed: !!subscription,
          isLoading: false,
          error: null,
          permission,
          deviceId
        });
      } catch (err) {
        setState(prev => ({
          ...prev,
          isSupported: true,
          isLoading: false,
          error: 'Failed to check subscription status'
        }));
      }
    };

    checkSupport();
  }, []);

  // Load preferences from backend
  const loadPreferences = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    setPrefsLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${BACKEND_URL}/push/preferences`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setPrefs({ ...defaultPrefs, ...data });
      }
    } catch (err) {
      console.error('Failed to load notification preferences:', err);
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.isSubscribed) {
      loadPreferences();
    }
  }, [state.isSubscribed, loadPreferences]);

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) {
      setState(prev => ({ ...prev, error: 'You must be logged in to enable notifications' }));
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Request permission
      const permission = await Notification.requestPermission();
      setState(prev => ({ ...prev, permission }));
      
      if (permission !== 'granted') {
        setState(prev => ({ 
          ...prev, 
          isLoading: false, 
          error: 'Notification permission denied' 
        }));
        return false;
      }

      // Get VAPID public key from backend
      const vapidResponse = await fetch(`${BACKEND_URL}/push/vapid-public-key`);
      if (!vapidResponse.ok) {
        throw new Error('Push notifications not configured on server');
      }
      const { publicKey } = await vapidResponse.json();

      // Register service worker if not already
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
      });

      // Optimistically update UI immediately (browser subscription succeeded)
      const deviceId = generateDeviceId();
      setState(prev => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
        error: null,
        deviceId
      }));

      // Send subscription to backend
      const token = await user.getIdToken();

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${BACKEND_URL}/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          deviceId,
          metadata: {
            userAgent: navigator.userAgent,
            platform: navigator.platform
          }
        }),
        signal: controller.signal
      }).finally(() => window.clearTimeout(timeout));

      if (!response.ok) {
        // Keep local subscription active, but surface error
        let message = `Failed to save subscription on server (${response.status})`;
        try {
          const errorData = await response.json();
          if (errorData?.details) message = errorData.details;
          else if (errorData?.error) message = errorData.error;
        } catch {}
        setState(prev => ({ ...prev, error: message }));
      }

      // Load preferences after subscribing
      loadPreferences();
      
      return true;
    } catch (err: any) {
      console.error('Push subscription error:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || 'Failed to subscribe to notifications'
      }));
      return false;
    }
  }, [loadPreferences]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) return false;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
      }

      // Optimistically update UI immediately
      setState(prev => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
        error: null
      }));

      // Remove from backend
      const token = await user.getIdToken();
      const deviceId = state.deviceId || generateDeviceId();
      
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${BACKEND_URL}/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ deviceId }),
        signal: controller.signal
      }).finally(() => window.clearTimeout(timeout));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Keep UI unsubscribed (browser already unsubscribed), but show server cleanup error
        setState(prev => ({
          ...prev,
          error: errorData.error || `Unsubscribe failed: ${response.status}`
        }));
      }
      return true;
    } catch (err: any) {
      console.error('Push unsubscribe error:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || 'Failed to unsubscribe'
      }));
      return false;
    }
  }, [state.deviceId]);

  // Update notification preferences
  const updatePreferences = useCallback(async (newPrefs: Partial<NotificationPrefs>): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) return false;

    setPrefsLoading(true);
    const updatedPrefs = { ...prefs, ...newPrefs };

    try {
      const token = await user.getIdToken();
      const response = await fetch(`${BACKEND_URL}/push/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updatedPrefs)
      });

      if (response.ok) {
        setPrefs(updatedPrefs);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update preferences:', err);
      return false;
    } finally {
      setPrefsLoading(false);
    }
  }, [prefs]);

  return {
    // State
    isSupported: state.isSupported,
    isSubscribed: state.isSubscribed,
    isLoading: state.isLoading,
    error: state.error,
    permission: state.permission,
    
    // Preferences
    preferences: prefs,
    prefsLoading,
    
    // Actions
    subscribe,
    unsubscribe,
    updatePreferences,
    refreshPreferences: loadPreferences
  };
}

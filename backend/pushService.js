/**
 * Web Push Notification Service
 * Uses VAPID for iOS PWA + Android/Desktop browser compatibility
 * Stores subscriptions in Firebase Realtime Database
 */

const webpush = require('web-push');
const firebaseAdmin = require('./firebaseAdmin');

function initializeFirebase() {
  const db = firebaseAdmin.getDb();
  if (!db) {
    if (!process.env.FIREBASE_DATABASE_URL) {
      console.warn('[PushService] FIREBASE_DATABASE_URL not set, push notifications disabled');
    } else {
      console.warn('[PushService] Firebase Admin not configured, push notifications disabled');
    }
  }
  return db;
}

// VAPID Configuration
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@csbatagi.com';

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return true;
  
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[PushService] VAPID keys not configured, push notifications disabled');
    return false;
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    console.log('[PushService] VAPID configured');
    return true;
  } catch (err) {
    console.error('[PushService] Failed to configure VAPID:', err.message);
    return false;
  }
}

// RTDB Paths
const PUSH_SUBSCRIPTIONS_PATH = 'pushSubscriptions';
const NOTIFICATION_PREFS_PATH = 'notificationPrefs';
const NOTIFICATION_LOG_PATH = 'notificationLog';

/**
 * Save a push subscription for a user
 * @param {string} uid - Firebase Auth user ID
 * @param {string} deviceId - Unique device identifier (hash of endpoint)
 * @param {object} subscription - Push API subscription object {endpoint, keys: {p256dh, auth}}
 * @param {object} metadata - Additional info {userAgent, platform}
 */
async function saveSubscription(uid, deviceId, subscription, metadata = {}) {
  const database = initializeFirebase();
  if (!database) throw new Error('Firebase not initialized');

  const subscriptionData = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userAgent: metadata.userAgent || 'unknown',
    platform: metadata.platform || 'unknown',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await database.ref(`${PUSH_SUBSCRIPTIONS_PATH}/${uid}/${deviceId}`).set(subscriptionData);
  console.log(`[PushService] Saved subscription for user ${uid}, device ${deviceId}`);
  return { success: true };
}

/**
 * Remove a push subscription
 */
async function removeSubscription(uid, deviceId) {
  const database = initializeFirebase();
  if (!database) throw new Error('Firebase not initialized');

  await database.ref(`${PUSH_SUBSCRIPTIONS_PATH}/${uid}/${deviceId}`).remove();
  console.log(`[PushService] Removed subscription for user ${uid}, device ${deviceId}`);
  return { success: true };
}

/**
 * Remove subscription by endpoint (used when push fails with 410 Gone)
 */
async function removeSubscriptionByEndpoint(endpoint) {
  const database = initializeFirebase();
  if (!database) return;

  const snapshot = await database.ref(PUSH_SUBSCRIPTIONS_PATH).once('value');
  const allUsers = snapshot.val() || {};

  for (const [uid, devices] of Object.entries(allUsers)) {
    for (const [deviceId, sub] of Object.entries(devices)) {
      if (sub.endpoint === endpoint) {
        await database.ref(`${PUSH_SUBSCRIPTIONS_PATH}/${uid}/${deviceId}`).remove();
        console.log(`[PushService] Removed stale subscription: ${uid}/${deviceId}`);
        return;
      }
    }
  }
}

/**
 * Get notification preferences for a user
 */
async function getNotificationPrefs(uid) {
  const database = initializeFirebase();
  if (!database) return {};

  const snapshot = await database.ref(`${NOTIFICATION_PREFS_PATH}/${uid}`).once('value');
  return snapshot.val() || {
    matchDay: true,
    stats: true,
    awards: true,
    tekerDondu: true
  };
}

/**
 * Update notification preferences for a user
 */
async function updateNotificationPrefs(uid, prefs) {
  const database = initializeFirebase();
  if (!database) throw new Error('Firebase not initialized');

  await database.ref(`${NOTIFICATION_PREFS_PATH}/${uid}`).update({
    ...prefs,
    updatedAt: Date.now()
  });
  return { success: true };
}

/**
 * Check if a notification has already been sent (dedupe)
 */
async function hasNotificationBeenSent(eventId) {
  const database = initializeFirebase();
  if (!database) return false;

  const snapshot = await database.ref(`${NOTIFICATION_LOG_PATH}/${eventId}`).once('value');
  return snapshot.exists();
}

/**
 * Mark a notification as sent
 */
async function markNotificationSent(eventId, metadata = {}) {
  const database = initializeFirebase();
  if (!database) return;

  await database.ref(`${NOTIFICATION_LOG_PATH}/${eventId}`).set({
    sentAt: Date.now(),
    recipientCount: metadata.recipientCount || 0,
    ...metadata
  });
}

/**
 * Send push notification to a single subscription
 * @returns {Promise<{success: boolean, statusCode?: number}>}
 */
async function sendToSubscription(subscription, payload) {
  if (!configureVapid()) {
    return { success: false, error: 'VAPID not configured' };
  }

  const pushPayload = JSON.stringify({
    title: payload.title || 'CS Batağı',
    body: payload.body || '',
    icon: payload.icon || '/images/BatakLogo192.png',
    badge: payload.badge || '/images/BatakLogo192.png',
    url: payload.url || '/',
    tag: payload.tag || 'default',
    data: payload.data || {}
  });

  try {
    const result = await webpush.sendNotification(subscription, pushPayload);
    return { success: true, statusCode: result.statusCode };
  } catch (err) {
    console.error(`[PushService] Send failed: ${err.statusCode} - ${err.message}`);
    
    // 410 Gone or 404 Not Found means subscription is invalid
    if (err.statusCode === 410 || err.statusCode === 404) {
      await removeSubscriptionByEndpoint(subscription.endpoint);
    }
    
    return { success: false, statusCode: err.statusCode, error: err.message };
  }
}

/**
 * Send push notification to a specific user (all their devices)
 */
async function sendToUser(uid, payload) {
  const database = initializeFirebase();
  if (!database) return { success: false, sent: 0, failed: 0 };

  const snapshot = await database.ref(`${PUSH_SUBSCRIPTIONS_PATH}/${uid}`).once('value');
  const devices = snapshot.val() || {};

  let sent = 0, failed = 0;
  for (const [deviceId, subscriptionData] of Object.entries(devices)) {
    const subscription = {
      endpoint: subscriptionData.endpoint,
      keys: subscriptionData.keys
    };
    const result = await sendToSubscription(subscription, payload);
    if (result.success) sent++; else failed++;
  }

  return { success: sent > 0, sent, failed };
}

/**
 * Send push notification to multiple users
 * @param {string[]} uids - Array of user IDs (null/undefined for all users)
 * @param {object} payload - Notification payload
 * @param {string} prefKey - Preference key to check (e.g., 'matchDay', 'stats')
 */
async function sendToUsers(uids, payload, prefKey = null) {
  const database = initializeFirebase();
  if (!database) return { success: false, sent: 0, failed: 0, skipped: 0 };

  let targetUids = uids;
  
  // If no specific UIDs, get all users with subscriptions
  if (!targetUids) {
    const snapshot = await database.ref(PUSH_SUBSCRIPTIONS_PATH).once('value');
    const allUsers = snapshot.val() || {};
    targetUids = Object.keys(allUsers);
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const uid of targetUids) {
    // Check preference if prefKey specified
    if (prefKey) {
      const prefs = await getNotificationPrefs(uid);
      if (prefs[prefKey] === false) {
        skipped++;
        continue;
      }
    }

    const result = await sendToUser(uid, payload);
    sent += result.sent;
    failed += result.failed;
  }

  return { success: sent > 0, sent, failed, skipped };
}

/**
 * Send notification for a specific event (with dedupe)
 */
async function sendEventNotification(eventId, payload, options = {}) {
  const { prefKey = null, targetUids = null, force = false } = options;

  // Check dedupe (unless forced)
  if (!force) {
    const alreadySent = await hasNotificationBeenSent(eventId);
    if (alreadySent) {
      console.log(`[PushService] Event ${eventId} already sent, skipping`);
      return { success: true, skipped: true, reason: 'already_sent' };
    }
  }

  const result = await sendToUsers(targetUids, payload, prefKey);
  
  // Mark as sent
  await markNotificationSent(eventId, {
    recipientCount: result.sent,
    payload: { title: payload.title, body: payload.body }
  });

  console.log(`[PushService] Event ${eventId}: sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped}`);
  return result;
}

// ============ Specific Notification Triggers ============

/**
 * Notify: New stats published
 */
async function notifyNewStats(timestamp) {
  const eventId = `stats:${timestamp}`;
  return sendEventNotification(eventId, {
    title: '📊 Yeni İstatistikler',
    body: 'Yeni maç istatistikleri yayınlandı!',
    url: '/season-avg',
    tag: 'new-stats'
  }, { prefKey: 'stats' });
}

/**
 * Notify: Monthly awards / MVP
 */
async function notifyAward(awardType, awardPeriod, details = {}) {
  const eventId = `award:${awardType}:${awardPeriod}`;
  return sendEventNotification(eventId, {
    title: `🏆 ${awardType === 'mvp' ? 'Maçın MVP\'si' : 'Aylık Ödüller'}`,
    body: details.message || `${awardPeriod} ödülleri açıklandı!`,
    url: awardType === 'mvp' ? '/gecenin-mvpsi' : '/performans-odulleri',
    tag: `award-${awardType}`
  }, { prefKey: 'awards' });
}

/**
 * Notify: Teker döndü (reached 10 people)
 */
async function notifyTekerDondu(matchId, goingCount) {
  const eventId = `teker:${matchId}`;
  return sendEventNotification(eventId, {
    title: '🎉 Teker Döndü!',
    body: `${goingCount} kişi oldu, maç var!`,
    url: '/attendance',
    tag: 'teker-dondu'
  }, { prefKey: 'tekerDondu' });
}

/**
 * Notify: Match day reminder (for users who haven't declared)
 * @param {string[]} undeclaredUids - UIDs of users who haven't declared status
 */
async function notifyMatchDayReminder(matchDate, undeclaredUids) {
  const eventId = `matchday:${matchDate}`;
  
  // For match day reminders, we only target specific users (who haven't declared)
  return sendEventNotification(eventId, {
    title: '⚽ Bugün Maç Var!',
    body: 'Katılım durumunu bildirmeyi unutma!',
    url: '/attendance',
    tag: 'match-day-reminder'
  }, { prefKey: 'matchDay', targetUids: undeclaredUids });
}

// Export everything
module.exports = {
  // Core functions
  initializeFirebase,
  configureVapid,
  
  // Subscription management
  saveSubscription,
  removeSubscription,
  removeSubscriptionByEndpoint,
  
  // Preferences
  getNotificationPrefs,
  updateNotificationPrefs,
  
  // Sending
  sendToSubscription,
  sendToUser,
  sendToUsers,
  sendEventNotification,
  
  // Specific triggers
  notifyNewStats,
  notifyAward,
  notifyTekerDondu,
  notifyMatchDayReminder,
  
  // Dedupe
  hasNotificationBeenSent,
  markNotificationSent,
  
  // Config
  VAPID_PUBLIC_KEY,
  PUSH_SUBSCRIPTIONS_PATH,
  NOTIFICATION_PREFS_PATH
};

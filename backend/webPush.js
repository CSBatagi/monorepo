/**
 * Web Push helper — replaces Firebase Cloud Messaging (FCM).
 *
 * Uses the standard Web Push protocol with VAPID authentication.
 * Required env vars:
 *   VAPID_PUBLIC_KEY   — base64url-encoded public key
 *   VAPID_PRIVATE_KEY  — base64url-encoded private key
 *   VAPID_SUBJECT      — mailto: or https: URL identifying the sender
 */

const webpush = require('web-push');

let configured = false;

function ensureConfigured() {
  if (configured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:csbatagi@gmail.com';

  if (!publicKey || !privateKey) {
    console.warn('[webPush] VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set — push notifications disabled');
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/**
 * Send a push notification to multiple subscriptions.
 *
 * @param {Array<string>} subscriptionJsons — array of JSON-stringified PushSubscription objects
 * @param {{ title: string, body: string, icon?: string, data?: Record<string, string> }} payload
 * @returns {{ successCount: number, failureCount: number, errors: string[] }}
 */
async function sendPushNotifications(subscriptionJsons, payload) {
  ensureConfigured();

  if (!configured) {
    return { successCount: 0, failureCount: 0, errors: ['VAPID keys not configured'] };
  }

  const payloadStr = JSON.stringify(payload);
  let successCount = 0;
  let failureCount = 0;
  const errors = [];

  const results = await Promise.allSettled(
    subscriptionJsons.map(async (subJson) => {
      let subscription;
      try {
        subscription = typeof subJson === 'string' ? JSON.parse(subJson) : subJson;
      } catch {
        throw new Error('Invalid subscription JSON');
      }

      await webpush.sendNotification(subscription, payloadStr, { TTL: 86400 });
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      successCount++;
    } else {
      failureCount++;
      const msg = result.reason?.message || result.reason?.statusCode?.toString() || 'unknown_error';
      errors.push(msg);
    }
  }

  return {
    successCount,
    failureCount,
    errors: [...new Set(errors)].slice(0, 20),
  };
}

module.exports = { sendPushNotifications, ensureConfigured };

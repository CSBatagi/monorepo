#!/usr/bin/env node
/**
 * One-time migration: copy notification data from Firebase RTDB to PostgreSQL.
 *
 * Migrates:
 *   - notifications/preferences → notification_preferences
 *   - notifications/subscriptions → notification_subscriptions
 *   - notifications/events (last 7 days) → notification_events
 *
 * Usage:
 *   node scripts/migrate-notifications.js
 *
 * Requires:
 *   - Firebase Admin env vars (FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON, FIREBASE_DATABASE_URL)
 *   - PostgreSQL env vars (DB_USER, DB_HOST, DB_DATABASE, DB_PASSWORD)
 *
 * Idempotent: uses ON CONFLICT DO NOTHING, safe to re-run.
 */

const { Pool } = require('pg');
const { adminDb } = require('../firebaseAdmin');

async function main() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: 5432,
  });

  console.log('[migrate-notifications] Reading from Firebase RTDB...');

  const db = adminDb();
  const [prefsSnap, subsSnap, eventsSnap] = await Promise.all([
    db.ref('notifications/preferences').get(),
    db.ref('notifications/subscriptions').get(),
    db.ref('notifications/events').get(),
  ]);

  const preferences = prefsSnap.val() || {};
  const subscriptions = subsSnap.val() || {};
  const events = eventsSnap.val() || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Migrate preferences ---
    let prefCount = 0;
    for (const [uid, pref] of Object.entries(preferences)) {
      if (!pref || typeof pref !== 'object') continue;
      await client.query(
        `INSERT INTO notification_preferences (uid, enabled, topics, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (uid) DO NOTHING`,
        [uid, pref.enabled !== false, JSON.stringify(pref.topics || {})]
      );
      prefCount++;
    }
    console.log(`[migrate-notifications] Migrated ${prefCount} preference records.`);

    // --- Migrate subscriptions ---
    let subCount = 0;
    for (const [uid, devices] of Object.entries(subscriptions)) {
      if (!devices || typeof devices !== 'object') continue;
      for (const [deviceId, device] of Object.entries(devices)) {
        if (!device || typeof device !== 'object' || !device.token) continue;
        await client.query(
          `INSERT INTO notification_subscriptions (uid, device_id, token, enabled, platform, user_agent, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (uid, device_id) DO NOTHING`,
          [
            uid,
            deviceId,
            device.token,
            device.enabled !== false,
            device.platform || null,
            (device.userAgent || '').slice(0, 200) || null,
          ]
        );
        subCount++;
      }
    }
    console.log(`[migrate-notifications] Migrated ${subCount} subscription records.`);

    // --- Migrate events (last 7 days only) ---
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let eventCount = 0;
    for (const [eventId, event] of Object.entries(events)) {
      if (!event || typeof event !== 'object') continue;
      const createdAt = typeof event.createdAt === 'number' ? event.createdAt : 0;
      if (createdAt < sevenDaysAgo) continue;

      await client.query(
        `INSERT INTO notification_events (event_id, status, topic, title, body, data, created_by_uid, created_by_name, created_at, sent_at, failed_at, recipient_count, success_count, failure_count, errors, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          eventId,
          event.status || 'sent',
          event.topic || null,
          event.title || null,
          event.body || null,
          event.data ? JSON.stringify(event.data) : null,
          event.createdByUid || null,
          event.createdByName || null,
          createdAt || Date.now(),
          event.sentAt ? new Date(event.sentAt) : null,
          event.failedAt ? new Date(event.failedAt) : null,
          event.recipientCount || null,
          event.successCount || null,
          event.failureCount || null,
          event.errors ? JSON.stringify(event.errors) : null,
          event.error || null,
        ]
      );
      eventCount++;
    }
    console.log(`[migrate-notifications] Migrated ${eventCount} event records (last 7 days).`);

    await client.query('COMMIT');
    console.log('[migrate-notifications] All migrations committed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[migrate-notifications] Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
  console.log('[migrate-notifications] Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

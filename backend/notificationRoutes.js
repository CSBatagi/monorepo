/**
 * Notification routes — preferences, subscriptions, and unified emit.
 *
 * Replaces Firebase RTDB paths:
 *   notifications/preferences/{uid}         → GET/PUT /preferences/:uid
 *   notifications/subscriptions/{uid}/{id}  → GET/PUT/DELETE /subscriptions/:uid/:deviceId
 *   notifications/events/{eventId}          → POST /emit (dedup + dispatch)
 *
 * Mount at /live/notifications in index.js.
 */

const express = require('express');
const { sendPushNotifications } = require('./webPush');
const notificationInboxStore = require('./notificationInboxStore');

const router = express.Router();
let dbPool = null;

function setup(pool) {
  dbPool = pool;
}

// ─── Helpers ───

function toStringMap(data) {
  if (!data) return {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = String(value);
  }
  return out;
}

function normalizeEventId(value) {
  return value.replace(/[.#$/\[\]]/g, '_');
}

const NOTIFICATION_TOPICS = [
  'teker_dondu_reached',
  'mvp_poll_locked',
  'stats_updated',
  'timed_reminders',
  'admin_custom_message',
];

// ─── Preferences ───

router.get('/preferences/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid required' });

    const r = await dbPool.query(
      `SELECT enabled, topics, updated_at FROM notification_preferences WHERE uid = $1`,
      [uid]
    );
    if (r.rows.length === 0) {
      return res.json({ enabled: true, topics: {} });
    }
    const row = r.rows[0];
    return res.json({ enabled: row.enabled, topics: row.topics || {} });
  } catch (e) {
    console.error('[notifications/preferences GET]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.put('/preferences/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid required' });

    const { enabled, topics } = req.body || {};
    await dbPool.query(
      `INSERT INTO notification_preferences (uid, enabled, topics, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (uid) DO UPDATE SET enabled = $2, topics = $3, updated_at = NOW()`,
      [uid, enabled !== false, JSON.stringify(topics || {})]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications/preferences PUT]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── Subscriptions ───

router.get('/subscriptions/:uid/:deviceId', async (req, res) => {
  try {
    const { uid, deviceId } = req.params;
    if (!uid || !deviceId) return res.status(400).json({ error: 'uid and deviceId required' });

    const r = await dbPool.query(
      `SELECT token, enabled, platform, user_agent, updated_at FROM notification_subscriptions WHERE uid = $1 AND device_id = $2`,
      [uid, deviceId]
    );
    if (r.rows.length === 0) {
      return res.json({ registered: false });
    }
    const row = r.rows[0];
    return res.json({ registered: true, enabled: row.enabled, token: row.token, platform: row.platform });
  } catch (e) {
    console.error('[notifications/subscriptions GET]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.put('/subscriptions/:uid/:deviceId', async (req, res) => {
  try {
    const { uid, deviceId } = req.params;
    if (!uid || !deviceId) return res.status(400).json({ error: 'uid and deviceId required' });

    const { token, enabled, platform, userAgent } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });

    await dbPool.query(
      `INSERT INTO notification_subscriptions (uid, device_id, token, enabled, platform, user_agent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (uid, device_id) DO UPDATE SET token = $3, enabled = $4, platform = $5, user_agent = $6, updated_at = NOW()`,
      [uid, deviceId, token, enabled !== false, platform || null, (userAgent || '').slice(0, 200) || null]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications/subscriptions PUT]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.delete('/subscriptions/:uid/:deviceId', async (req, res) => {
  try {
    const { uid, deviceId } = req.params;
    if (!uid || !deviceId) return res.status(400).json({ error: 'uid and deviceId required' });

    await dbPool.query(
      `DELETE FROM notification_subscriptions WHERE uid = $1 AND device_id = $2`,
      [uid, deviceId]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications/subscriptions DELETE]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── Resolve Recipients (PG) ───

async function resolveRecipients(topic) {
  // JOIN subscriptions + preferences; filter by topic opt-out
  const r = await dbPool.query(
    `SELECT s.uid, s.token
     FROM notification_subscriptions s
     LEFT JOIN notification_preferences p ON p.uid = s.uid
     WHERE s.enabled = true
       AND s.token IS NOT NULL
       AND s.token != ''
       AND (p.uid IS NULL OR (p.topics->$1)::text IS DISTINCT FROM 'false')`,
    [topic]
  );

  const tokens = new Set();
  const recipientUids = new Set();
  for (const row of r.rows) {
    tokens.add(row.token);
    recipientUids.add(row.uid);
  }
  return { tokens: [...tokens], recipientUids: [...recipientUids] };
}

// ─── Web Push Dispatch ───

async function dispatchPush(params) {
  const { tokens, recipientUids } = await resolveRecipients(params.topic);

  // Persist to in-app inbox (fire-and-forget)
  const inboxPromise = (recipientUids.length > 0)
    ? notificationInboxStore.persistToInbox({
        recipientUids,
        topic: params.topic,
        title: params.title,
        body: params.body,
        data: params.data ? toStringMap(params.data) : null,
        eventId: params.eventId || null,
        createdAt: Date.now(),
      }).catch(err => console.error('[notificationRoutes] persistToInbox failed:', err))
    : Promise.resolve();

  if (tokens.length === 0) {
    await inboxPromise;
    return { recipientCount: 0, successCount: 0, failureCount: 0, errors: [] };
  }

  const payload = {
    title: params.title,
    body: params.body,
    icon: '/images/BatakLogo192.png',
    data: {
      topic: params.topic,
      ...toStringMap(params.data),
      link: typeof params.data?.link === 'string' && params.data.link.length > 0
        ? params.data.link : '/',
    },
  };

  // tokens contain JSON-stringified PushSubscription objects
  const result = await sendPushNotifications(tokens, payload);

  await inboxPromise;
  return {
    recipientCount: tokens.length,
    successCount: result.successCount,
    failureCount: result.failureCount,
    errors: result.errors,
  };
}

// ─── Unified Emit ───

router.post('/emit', async (req, res) => {
  try {
    const { eventId, topic, title, body, data, createdByUid, createdByName } = req.body || {};

    if (!eventId || !topic) {
      return res.status(400).json({ error: 'eventId and topic required' });
    }
    if (!NOTIFICATION_TOPICS.includes(topic)) {
      return res.status(400).json({ error: 'invalid topic' });
    }
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body required' });
    }

    const safeEventId = normalizeEventId(eventId);

    // PG dedup: try to claim this event. Skip if already sent, or if pending and recent (<30s).
    const insertResult = await dbPool.query(
      `INSERT INTO notification_events (event_id, status, topic, title, body, data, created_by_uid, created_by_name, created_at)
       VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (event_id) DO UPDATE
         SET status = 'pending', topic = $2, title = $3, body = $4, data = $5, created_by_uid = $6, created_by_name = $7, created_at = NOW()
         WHERE notification_events.status != 'sent'
           AND notification_events.created_at < NOW() - INTERVAL '30 seconds'
       RETURNING event_id`,
      [safeEventId, topic, title, body, JSON.stringify(data || null), createdByUid || 'system', createdByName || 'system']
    );

    if (insertResult.rows.length === 0) {
      return res.json({ ok: true, eventId: safeEventId, duplicate: true });
    }

    // Dispatch
    const result = await dispatchPush({
      topic,
      title,
      body,
      data: { ...(data || {}), eventId },
      eventId: safeEventId,
    });

    // Mark as sent
    await dbPool.query(
      `UPDATE notification_events SET status = 'sent', sent_at = NOW(), recipient_count = $2, success_count = $3, failure_count = $4, errors = $5
       WHERE event_id = $1`,
      [safeEventId, result.recipientCount, result.successCount, result.failureCount, JSON.stringify(result.errors)]
    );

    return res.json({
      ok: true,
      eventId: safeEventId,
      duplicate: false,
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      errors: result.errors,
    });
  } catch (e) {
    console.error('[notifications/emit POST]', e.message);

    // Try to mark event as failed
    const safeEventId = normalizeEventId(req.body?.eventId || '');
    if (safeEventId) {
      await dbPool.query(
        `UPDATE notification_events SET status = 'failed', failed_at = NOW(), error = $2 WHERE event_id = $1`,
        [safeEventId, e.message || 'dispatch_failed']
      ).catch(() => {});
    }

    return res.status(500).json({ error: 'emit_failed', details: e.message || 'unknown_error' });
  }
});

module.exports = { router, setup, resolveRecipients };

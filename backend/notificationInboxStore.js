const crypto = require('crypto');

let pool = null;

function setup(dbPool) {
  pool = dbPool;
}

function getPool() {
  if (!pool) {
    throw new Error('notification inbox store not initialized');
  }
  return pool;
}

async function bumpVersion(userUid, queryable) {
  const db = queryable || getPool();
  const result = await db.query(
    `INSERT INTO notification_inbox_version (user_uid, version, updated_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (user_uid) DO UPDATE
       SET version = notification_inbox_version.version + 1,
           updated_at = NOW()
     RETURNING version`,
    [userUid]
  );
  return Number(result.rows[0]?.version || 0);
}

async function getVersion(userUid, queryable) {
  if (!userUid) return 0;
  const db = queryable || getPool();
  const result = await db.query(
    `SELECT version FROM notification_inbox_version WHERE user_uid = $1`,
    [userUid]
  );
  return Number(result.rows[0]?.version || 0);
}

function mapRow(row) {
  return {
    id: row.id,
    topic: row.topic,
    title: row.title,
    body: row.body,
    data: row.data || undefined,
    read: row.read === true,
    createdAt: Number(row.created_at || 0),
    eventId: row.event_id || undefined,
  };
}

async function listInbox(userUid, limit = 100) {
  const db = getPool();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  // Merge per-user inbox entries with broadcast events from notification_events
  // that the user hasn't seen yet. This ensures ALL logged-in users see
  // notifications in the bell, even without push subscriptions.
  const [version, rows] = await Promise.all([
    getVersion(userUid, db),
    db.query(
      `SELECT id, topic, title, body, data, read, created_at, event_id FROM (
         SELECT id, topic, title, body, data, read, created_at, event_id
         FROM notification_inbox
         WHERE user_uid = $1
       UNION ALL
         SELECT e.event_id AS id, e.topic, e.title, e.body, e.data, FALSE AS read,
                (EXTRACT(EPOCH FROM e.created_at) * 1000)::bigint AS created_at,
                e.event_id
         FROM notification_events e
         WHERE e.status = 'sent'
           AND NOT EXISTS (
             SELECT 1 FROM notification_inbox i
             WHERE i.user_uid = $1 AND i.event_id = e.event_id
           )
           AND e.created_at > NOW() - INTERVAL '30 days'
       ) combined
       ORDER BY created_at DESC
       LIMIT $2`,
      [userUid, cappedLimit]
    ),
  ]);
  return {
    version,
    notifications: rows.rows.map(mapRow),
  };
}

async function persistToInbox(params) {
  const db = getPool();
  const recipientUids = Array.isArray(params?.recipientUids)
    ? [...new Set(params.recipientUids.filter((uid) => typeof uid === 'string' && uid.trim()))]
    : [];

  if (recipientUids.length === 0) {
    return { inserted: 0 };
  }

  const title = typeof params.title === 'string' ? params.title : '';
  const body = typeof params.body === 'string' ? params.body : '';
  const topic = typeof params.topic === 'string' ? params.topic : 'admin_custom_message';
  const eventId = typeof params.eventId === 'string' ? params.eventId : null;
  const data = params.data && typeof params.data === 'object' ? params.data : null;
  const createdAt = Number(params.createdAt || Date.now());

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const userUid of recipientUids) {
      await client.query(
        `INSERT INTO notification_inbox
          (id, user_uid, topic, title, body, data, read, created_at, event_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, FALSE, $7, $8, NOW())`,
        [crypto.randomUUID(), userUid, topic, title, body, JSON.stringify(data), createdAt, eventId]
      );
      await bumpVersion(userUid, client);
    }
    await client.query('COMMIT');
    return { inserted: recipientUids.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markAsRead(userUid, notificationId) {
  const db = getPool();
  // Try to mark an existing personal inbox entry as read
  const result = await db.query(
    `UPDATE notification_inbox
     SET read = TRUE, updated_at = NOW()
     WHERE user_uid = $1 AND id = $2 AND read = FALSE`,
    [userUid, notificationId]
  );
  if (result.rowCount > 0) {
    await bumpVersion(userUid, db);
    return { updated: true };
  }
  // If not found in personal inbox, it might be a broadcast event from notification_events.
  // Insert a read entry so it stops appearing as unread in the UNION query.
  const eventRow = await db.query(
    `SELECT event_id, topic, title, body, data, created_at
     FROM notification_events WHERE event_id = $1 AND status = 'sent'`,
    [notificationId]
  );
  if (eventRow.rows.length > 0) {
    const e = eventRow.rows[0];
    await db.query(
      `INSERT INTO notification_inbox
        (id, user_uid, topic, title, body, data, read, created_at, event_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE, $7, $8, NOW())
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), userUid, e.topic, e.title, e.body,
       JSON.stringify(e.data), Math.floor(new Date(e.created_at).getTime()), e.event_id]
    );
    await bumpVersion(userUid, db);
    return { updated: true };
  }
  return { updated: false };
}

async function markAllAsRead(userUid) {
  const db = getPool();
  // Mark existing personal entries as read
  const result = await db.query(
    `UPDATE notification_inbox
     SET read = TRUE, updated_at = NOW()
     WHERE user_uid = $1 AND read = FALSE`,
    [userUid]
  );
  // Also materialize any unread broadcast events as read personal entries
  const broadcastRows = await db.query(
    `SELECT e.event_id, e.topic, e.title, e.body, e.data, e.created_at
     FROM notification_events e
     WHERE e.status = 'sent'
       AND NOT EXISTS (
         SELECT 1 FROM notification_inbox i
         WHERE i.user_uid = $1 AND i.event_id = e.event_id
       )
       AND e.created_at > NOW() - INTERVAL '30 days'`,
    [userUid]
  );
  for (const e of broadcastRows.rows) {
    await db.query(
      `INSERT INTO notification_inbox
        (id, user_uid, topic, title, body, data, read, created_at, event_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE, $7, $8, NOW())
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), userUid, e.topic, e.title, e.body,
       JSON.stringify(e.data), Math.floor(new Date(e.created_at).getTime()), e.event_id]
    );
  }
  const totalUpdated = (result.rowCount || 0) + broadcastRows.rows.length;
  if (totalUpdated > 0) {
    await bumpVersion(userUid, db);
  }
  return { updated: totalUpdated };
}

async function deleteNotification(userUid, notificationId) {
  const db = getPool();
  const result = await db.query(
    `DELETE FROM notification_inbox
     WHERE user_uid = $1 AND id = $2`,
    [userUid, notificationId]
  );
  if (result.rowCount > 0) {
    await bumpVersion(userUid, db);
  }
  return { deleted: result.rowCount > 0 };
}

async function clearInbox(userUid) {
  const db = getPool();
  const result = await db.query(
    `DELETE FROM notification_inbox
     WHERE user_uid = $1`,
    [userUid]
  );
  if (result.rowCount > 0) {
    await bumpVersion(userUid, db);
  }
  return { deleted: result.rowCount };
}

module.exports = {
  setup,
  getVersion,
  listInbox,
  persistToInbox,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearInbox,
};

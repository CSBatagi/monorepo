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
  const [version, rows] = await Promise.all([
    getVersion(userUid, db),
    db.query(
      `SELECT id, topic, title, body, data, read, created_at, event_id
       FROM notification_inbox
       WHERE user_uid = $1
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
  const result = await db.query(
    `UPDATE notification_inbox
     SET read = TRUE, updated_at = NOW()
     WHERE user_uid = $1 AND id = $2 AND read = FALSE`,
    [userUid, notificationId]
  );
  if (result.rowCount > 0) {
    await bumpVersion(userUid, db);
  }
  return { updated: result.rowCount > 0 };
}

async function markAllAsRead(userUid) {
  const db = getPool();
  const result = await db.query(
    `UPDATE notification_inbox
     SET read = TRUE, updated_at = NOW()
     WHERE user_uid = $1 AND read = FALSE`,
    [userUid]
  );
  if (result.rowCount > 0) {
    await bumpVersion(userUid, db);
  }
  return { updated: result.rowCount };
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

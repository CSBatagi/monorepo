const express = require('express');
const store = require('./notificationInboxStore');

const router = express.Router();

router.post('/list', async (req, res) => {
  try {
    const userUid = typeof req.body?.userUid === 'string' ? req.body.userUid.trim() : '';
    const clientVersion = Number(req.body?.version || 0);
    const limit = Number(req.body?.limit || 100);

    if (!userUid) {
      return res.status(400).json({ error: 'userUid required' });
    }

    const serverVersion = await store.getVersion(userUid);
    // Version match only means no personal inbox changes. We must also check
    // for new broadcast events in notification_events that this user hasn't seen.
    if (clientVersion > 0 && clientVersion >= serverVersion) {
      const hasNew = await store.hasUnseenBroadcasts(userUid);
      if (!hasNew) {
        return res.status(304).end();
      }
    }

    const payload = await store.listInbox(userUid, limit);
    return res.json(payload);
  } catch (error) {
    console.error('[live/notifications/inbox/list POST]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/persist', async (req, res) => {
  try {
    const result = await store.persistToInbox(req.body || {});
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[live/notifications/inbox/persist POST]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/mark-all', async (req, res) => {
  try {
    const userUid = typeof req.body?.userUid === 'string' ? req.body.userUid.trim() : '';
    if (!userUid) {
      return res.status(400).json({ error: 'userUid required' });
    }
    const result = await store.markAllAsRead(userUid);
    const version = await store.getVersion(userUid);
    return res.json({ ok: true, version, ...result });
  } catch (error) {
    console.error('[live/notifications/inbox/mark-all POST]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/clear', async (req, res) => {
  try {
    const userUid = typeof req.body?.userUid === 'string' ? req.body.userUid.trim() : '';
    if (!userUid) {
      return res.status(400).json({ error: 'userUid required' });
    }
    const result = await store.clearInbox(userUid);
    const version = await store.getVersion(userUid);
    return res.json({ ok: true, version, ...result });
  } catch (error) {
    console.error('[live/notifications/inbox/clear POST]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const notificationId = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
    const userUid = typeof req.body?.userUid === 'string' ? req.body.userUid.trim() : '';
    if (!userUid || !notificationId) {
      return res.status(400).json({ error: 'userUid and id required' });
    }
    const result = await store.markAsRead(userUid, notificationId);
    const version = await store.getVersion(userUid);
    return res.json({ ok: true, version, ...result });
  } catch (error) {
    console.error('[live/notifications/inbox/:id/read POST]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    const notificationId = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
    const userUid = typeof req.body?.userUid === 'string' ? req.body.userUid.trim() : '';
    if (!userUid || !notificationId) {
      return res.status(400).json({ error: 'userUid and id required' });
    }
    const result = await store.deleteNotification(userUid, notificationId);
    const version = await store.getVersion(userUid);
    return res.json({ ok: true, version, ...result });
  } catch (error) {
    console.error('[live/notifications/inbox/:id/delete POST]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = { router };

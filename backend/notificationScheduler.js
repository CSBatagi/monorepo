/**
 * Notification scheduler — runs as a background loop in the backend process.
 *
 * Two responsibilities:
 * 1. Timed rule checks (attendance reminders on specific days/times)
 * 2. Stats-update notifications (when DB data changes)
 *
 * This was previously in the Next.js frontend process, which forced firebase-admin
 * to stay loaded there (~50 MB RSS). Moving it here keeps the frontend lean.
 */

const { adminDb, adminMessaging } = require('./firebaseAdmin');

// ─── Constants ───

const ISTANBUL_TZ = 'Europe/Istanbul';
const SCHEDULER_INTERVAL_MS = 60_000;  // 60 seconds
const STATS_CHECK_COOLDOWN_MS = 60_000;

// ─── Notification topics ───

const NOTIFICATION_TOPICS = [
  'teker_dondu_reached',
  'mvp_poll_locked',
  'stats_updated',
  'timed_reminders',
  'admin_custom_message',
];

// ─── Timed notification rules ───
// Ported from frontend-nextjs/src/lib/notificationScheduleRules.ts

const TIMED_NOTIFICATION_RULES = [
  {
    id: 'monday_2200_play_tomorrow',
    dayOfWeek: 1,
    hour: 22,
    minute: 0,
    title: 'Yarın oynuyor musun?',
    body: (ctx) => `Şu ana kadar ${ctx.comingCount} kişi geliyorum dedi.`,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: '/attendance' }),
  },
  {
    id: 'thursday_2200_play_tomorrow',
    dayOfWeek: 4,
    hour: 22,
    minute: 0,
    title: 'Yarın oynuyor musun?',
    body: (ctx) => `Şu ana kadar ${ctx.comingCount} kişi geliyorum dedi.`,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: '/attendance' }),
  },
  {
    id: 'tuesday_2130_odd_players',
    dayOfWeek: 2,
    hour: 21,
    minute: 30,
    title: 'Tek kaldık',
    body: (ctx) => `Katılım şu an tek sayı (${ctx.comingCount}). Bir kişi daha lazım olabilir.`,
    condition: (ctx) => ctx.comingCount >= 10 && ctx.comingCount % 2 === 1,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: '/attendance' }),
  },
  {
    id: 'friday_2130_odd_players',
    dayOfWeek: 5,
    hour: 21,
    minute: 30,
    title: 'Tek kaldık',
    body: (ctx) => `Katılım şu an tek sayı (${ctx.comingCount}). Bir kişi daha lazım olabilir.`,
    condition: (ctx) => ctx.comingCount >= 10 && ctx.comingCount % 2 === 1,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: '/attendance' }),
  },
  {
    id: 'tuesday_2130_under_threshold',
    dayOfWeek: 2,
    hour: 21,
    minute: 30,
    title: 'Teker tehlikede',
    body: (ctx) => `Maça 1 saat kaldı ama sadece ${ctx.comingCount} kişi var. Beyler bi el atın`,
    condition: (ctx) => ctx.comingCount > 0 && ctx.comingCount < 10,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: '/attendance' }),
  },
  {
    id: 'friday_2130_under_threshold',
    dayOfWeek: 5,
    hour: 21,
    minute: 30,
    title: 'Teker tehlikede',
    body: (ctx) => `Maça 1 saat kaldı ama sadece ${ctx.comingCount} kişi var. Beyler bi el atın`,
    condition: (ctx) => ctx.comingCount > 0 && ctx.comingCount < 10,
    data: (ctx) => ({ comingCount: ctx.comingCount, link: '/attendance' }),
  },
];

// ─── State ───

let lastStatsCheckAt = 0;
let lastKnownStatsTimestamp = null;
let warnedMissingFirebase = false;
let schedulerStarted = false;
let schedulerTimer = null;

// ─── Helpers ───

function getIstanbulTimeParts(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISTANBUL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dayOfWeek: weekdayMap[map.weekday] ?? 0,
    hour: Number(map.hour),
    minute: Number(map.minute),
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function normalizeEventId(value) {
  return value.replace(/[.#$/\[\]]/g, '_');
}

function toStringMap(data) {
  if (!data) return {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = String(value);
  }
  return out;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ─── Notification dispatch (ported from serverNotifications.ts) ───

async function resolveRecipients(topic) {
  const db = adminDb();
  const [prefSnap, subsSnap] = await Promise.all([
    db.ref('notifications/preferences').get(),
    db.ref('notifications/subscriptions').get(),
  ]);

  const preferences = prefSnap.val() || {};
  const subscriptions = subsSnap.val() || {};
  const tokens = new Set();
  const recipientUids = new Set();

  for (const [uid, userDevices] of Object.entries(subscriptions)) {
    const userPref = preferences[uid];
    const topicEnabled = userPref?.topics?.[topic] !== false;
    if (!topicEnabled) continue;

    let hasActiveDevice = false;
    for (const device of Object.values(userDevices || {})) {
      if (!device || device.enabled !== true || !device.token) continue;
      tokens.add(device.token);
      hasActiveDevice = true;
    }
    if (hasActiveDevice) recipientUids.add(uid);
  }

  return { tokens: [...tokens], recipientUids: [...recipientUids] };
}

async function persistToInbox(params) {
  if (params.recipientUids.length === 0) return;
  const database = adminDb();
  const now = Date.now();
  const updates = {};

  for (const uid of params.recipientUids) {
    const pushKey = database.ref(`notifications/inbox/${uid}`).push().key;
    if (!pushKey) continue;
    updates[`notifications/inbox/${uid}/${pushKey}`] = {
      topic: params.topic,
      title: params.title,
      body: params.body,
      data: params.data ? toStringMap(params.data) : null,
      read: false,
      createdAt: now,
      eventId: params.eventId || null,
    };
  }

  try {
    await database.ref().update(updates);
  } catch (err) {
    console.error('[notification-scheduler] persistToInbox failed:', err);
  }
}

async function dispatchTopicNotification(params) {
  const { tokens, recipientUids } = await resolveRecipients(params.topic);

  const inboxPromise = persistToInbox({
    recipientUids,
    topic: params.topic,
    title: params.title,
    body: params.body,
    data: params.data,
    eventId: typeof params.data?.eventId === 'string' ? params.data.eventId : undefined,
  });

  if (tokens.length === 0) {
    await inboxPromise;
    return { recipientCount: 0, successCount: 0, failureCount: 0, errors: [] };
  }

  const messageData = {
    topic: params.topic,
    title: params.title,
    body: params.body,
    icon: '/images/BatakLogo192.png',
    ...toStringMap(params.data),
  };

  const messaging = adminMessaging();
  const tokenChunks = chunk(tokens, 500);
  let successCount = 0;
  let failureCount = 0;
  const errors = [];

  for (const tokenChunk of tokenChunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: tokenChunk,
      data: messageData,
      webpush: {
        fcmOptions: {
          link: typeof params.data?.link === 'string' && params.data.link.length > 0
            ? params.data.link : '/',
        },
      },
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((entry) => {
      if (!entry.success && entry.error) errors.push(entry.error.message);
    });
  }

  await inboxPromise;
  return { recipientCount: tokens.length, successCount, failureCount, errors: [...new Set(errors)].slice(0, 20) };
}

async function emitNotificationEvent(params) {
  const safeEventId = normalizeEventId(params.eventId);
  const eventRef = adminDb().ref(`notifications/events/${safeEventId}`);
  const tx = await eventRef.transaction(
    (current) => {
      if (current?.status === 'sent') return;
      if (current?.status === 'pending' && typeof current?.createdAt === 'number' && Date.now() - current.createdAt < 30000) return;
      return {
        eventId: safeEventId,
        topic: params.topic,
        status: 'pending',
        createdAt: Date.now(),
        createdByUid: params.createdByUid || 'scheduler',
        createdByName: params.createdByName || 'notification-scheduler',
        title: params.title,
        body: params.body,
        data: params.data || null,
      };
    },
    undefined,
    false
  );

  if (!tx.committed) return { eventId: safeEventId, duplicate: true };

  try {
    const result = await dispatchTopicNotification({
      topic: params.topic,
      title: params.title,
      body: params.body,
      data: { ...(params.data || {}), eventId: params.eventId },
    });
    await eventRef.update({
      status: 'sent',
      sentAt: Date.now(),
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      errors: result.errors,
    });
    return { eventId: safeEventId, duplicate: false, dispatch: result };
  } catch (dispatchError) {
    await eventRef.update({
      status: 'failed',
      failedAt: Date.now(),
      error: dispatchError?.message || 'dispatch_failed',
    });
    throw dispatchError;
  }
}

// ─── Scheduler checks ───

async function resolveComingCount() {
  const snap = await adminDb().ref('attendanceState').get();
  const attendance = snap.val() || {};
  return Object.values(attendance).filter((item) => item?.status === 'coming').length;
}

async function runTimedRuleCheck() {
  if (TIMED_NOTIFICATION_RULES.length === 0) return;

  const now = new Date();
  const ist = getIstanbulTimeParts(now);
  const comingCount = await resolveComingCount();
  const ctx = { now, dayOfWeek: ist.dayOfWeek, hour: ist.hour, minute: ist.minute, dateKey: ist.dateKey, comingCount };

  for (const rule of TIMED_NOTIFICATION_RULES) {
    if (ctx.dayOfWeek !== rule.dayOfWeek || ctx.hour !== rule.hour || ctx.minute !== rule.minute) continue;
    if (rule.condition && !rule.condition(ctx)) continue;

    const extraData = rule.data ? rule.data(ctx) : {};
    const linkValue = typeof extraData.link === 'string' ? extraData.link : '/attendance';
    const data = { scheduleId: rule.id, ...extraData, link: linkValue };
    const eventId = `timed:${rule.id}:${ctx.dateKey}`;

    await emitNotificationEvent({
      eventId,
      topic: 'timed_reminders',
      title: rule.title,
      body: rule.body(ctx),
      data,
      createdByUid: 'scheduler',
      createdByName: 'notification-scheduler',
    });
  }
}

/**
 * Stats update check — uses the getCachedDataTimestamp function from the main
 * backend process (injected via start()) instead of fetching from an HTTP endpoint.
 */
let getTimestampFn = null;

async function runStatsUpdateCheck() {
  const now = Date.now();
  if (now - lastStatsCheckAt < STATS_CHECK_COOLDOWN_MS) return;
  lastStatsCheckAt = now;

  if (!getTimestampFn) return;
  const serverTs = getTimestampFn();
  if (!serverTs) return;

  const serverTimestamp = new Date(serverTs).toISOString();
  if (lastKnownStatsTimestamp && serverTimestamp === lastKnownStatsTimestamp) return;

  const wasNull = !lastKnownStatsTimestamp;
  lastKnownStatsTimestamp = serverTimestamp;

  // Don't send notification on first startup (initial load)
  if (wasNull) return;

  await emitNotificationEvent({
    eventId: `stats_updated:${serverTimestamp}`,
    topic: 'stats_updated',
    title: 'Yeni statlar basıldı',
    body: 'Veritabanı güncellendi. Son istatistikler hazır.',
    data: { serverTimestamp, link: '/season-avg' },
    createdByUid: 'scheduler',
    createdByName: 'notification-scheduler',
  });
}

// ─── Public API ───

/**
 * Start the notification scheduler.
 * @param {Object} options
 * @param {Function} options.getCachedDataTimestamp — returns the cached DB timestamp (from index.js)
 */
function start(options = {}) {
  if (process.env.ENABLE_NOTIFICATION_SCHEDULER === 'false') {
    console.log('[notification-scheduler] Disabled via ENABLE_NOTIFICATION_SCHEDULER=false');
    return;
  }

  // Check if Firebase credentials are available
  const hasCreds = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64;
  const hasDbUrl = process.env.FIREBASE_DATABASE_URL || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!hasCreds || !hasDbUrl) {
    if (!warnedMissingFirebase) {
      warnedMissingFirebase = true;
      console.warn('[notification-scheduler] Firebase credentials not configured; scheduler disabled.');
    }
    return;
  }

  if (schedulerStarted) return;
  schedulerStarted = true;

  getTimestampFn = options.getCachedDataTimestamp || null;

  console.log('[notification-scheduler] Starting (interval: %dms)', SCHEDULER_INTERVAL_MS);

  // Initial check
  void Promise.all([runTimedRuleCheck(), runStatsUpdateCheck()]).catch((error) => {
    console.error('[notification-scheduler] initial check failed', error);
  });

  schedulerTimer = setInterval(() => {
    void Promise.all([runTimedRuleCheck(), runStatsUpdateCheck()]).catch((error) => {
      console.error('[notification-scheduler] timed check failed', error);
    });
  }, SCHEDULER_INTERVAL_MS);
}

module.exports = { start };

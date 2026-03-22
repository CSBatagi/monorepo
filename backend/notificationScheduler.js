/**
 * Notification scheduler — runs as a background loop in the backend process.
 *
 * Two responsibilities:
 * 1. Timed rule checks (attendance reminders on specific days/times)
 * 2. Stats-update notifications (when DB data changes)
 *
 * Dispatch uses PG-based dedup + resolve recipients + Web Push, matching
 * the notificationRoutes.js emit endpoint logic.
 */

const notificationRoutes = require('./notificationRoutes');
const { sendPushNotifications } = require('./webPush');
const notificationInboxStore = require('./notificationInboxStore');

// ─── Constants ───

const ISTANBUL_TZ = 'Europe/Istanbul';
const SCHEDULER_INTERVAL_MS = 60_000;  // 60 seconds
const STATS_CHECK_COOLDOWN_MS = 60_000;

// ─── Timed notification rules ───

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

// ─── Notification dispatch (PG-based) ───

// Pool is injected via start().
let dbPool = null;

async function emitNotificationEvent(params) {
  const safeEventId = normalizeEventId(params.eventId);

  // PG dedup: try to claim this event
  const insertResult = await dbPool.query(
    `INSERT INTO notification_events (event_id, status, topic, title, body, data, created_by_uid, created_by_name, created_at)
     VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (event_id) DO UPDATE
       SET status = 'pending', topic = $2, title = $3, body = $4, data = $5, created_by_uid = $6, created_by_name = $7, created_at = NOW()
       WHERE notification_events.status != 'sent'
         AND notification_events.created_at < NOW() - INTERVAL '30 seconds'
     RETURNING event_id`,
    [safeEventId, params.topic, params.title, params.body, JSON.stringify(params.data || null), params.createdByUid || 'scheduler', params.createdByName || 'notification-scheduler']
  );

  if (insertResult.rows.length === 0) {
    return { eventId: safeEventId, duplicate: true };
  }

  try {
    // Resolve recipients from PG
    const { tokens, recipientUids } = await notificationRoutes.resolveRecipients(params.topic);

    // Persist to inbox
    if (recipientUids.length > 0) {
      await notificationInboxStore.persistToInbox({
        recipientUids,
        topic: params.topic,
        title: params.title,
        body: params.body,
        data: params.data ? toStringMap(params.data) : null,
        eventId: safeEventId,
        createdAt: Date.now(),
      }).catch(err => console.error('[notification-scheduler] persistToInbox failed:', err));
    }

    if (tokens.length === 0) {
      await dbPool.query(
        `UPDATE notification_events SET status = 'sent', sent_at = NOW(), recipient_count = 0, success_count = 0, failure_count = 0 WHERE event_id = $1`,
        [safeEventId]
      );
      return { eventId: safeEventId, duplicate: false, dispatch: { recipientCount: 0, successCount: 0, failureCount: 0, errors: [] } };
    }

    // Web Push dispatch
    const payload = {
      title: params.title,
      body: params.body,
      icon: '/images/BatakLogo192.png',
      data: {
        topic: params.topic,
        ...toStringMap({ ...(params.data || {}), eventId: params.eventId }),
        link: typeof params.data?.link === 'string' && params.data.link.length > 0
          ? params.data.link : '/',
      },
    };

    // tokens contain JSON-stringified PushSubscription objects
    const pushResult = await sendPushNotifications(tokens, payload);

    const result = {
      recipientCount: tokens.length,
      successCount: pushResult.successCount,
      failureCount: pushResult.failureCount,
      errors: pushResult.errors,
    };

    await dbPool.query(
      `UPDATE notification_events SET status = 'sent', sent_at = NOW(), recipient_count = $2, success_count = $3, failure_count = $4, errors = $5
       WHERE event_id = $1`,
      [safeEventId, result.recipientCount, result.successCount, result.failureCount, JSON.stringify(result.errors)]
    );

    return { eventId: safeEventId, duplicate: false, dispatch: result };
  } catch (dispatchError) {
    await dbPool.query(
      `UPDATE notification_events SET status = 'failed', failed_at = NOW(), error = $2 WHERE event_id = $1`,
      [safeEventId, dispatchError?.message || 'dispatch_failed']
    ).catch(() => {});
    throw dispatchError;
  }
}

// ─── Scheduler checks ───

async function resolveComingCount() {
  if (!dbPool) return 0;
  try {
    const r = await dbPool.query(`SELECT COUNT(*) AS cnt FROM attendance WHERE status = 'coming'`);
    return parseInt(r.rows[0]?.cnt, 10) || 0;
  } catch (e) {
    console.error('[notification-scheduler] resolveComingCount DB error:', e.message);
    return 0;
  }
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
 * @param {Object}   options.pool — PostgreSQL pool for attendance queries and notification dispatch
 */
function start(options = {}) {
  if (process.env.ENABLE_NOTIFICATION_SCHEDULER === 'false') {
    console.log('[notification-scheduler] Disabled via ENABLE_NOTIFICATION_SCHEDULER=false');
    return;
  }

  if (schedulerStarted) return;
  schedulerStarted = true;

  getTimestampFn = options.getCachedDataTimestamp || null;
  dbPool = options.pool || null;

  if (!dbPool) {
    console.warn('[notification-scheduler] No pool provided; scheduler disabled.');
    return;
  }

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

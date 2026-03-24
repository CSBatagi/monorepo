const express = require('express');
const { Pool } = require('pg');
const { json } = require('body-parser');
const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');
const RconConnection = require('./rcon.js');
const GcpManager = require('./gcp.js');
const { resolveSeasonConfig } = require('./seasonConfig');


const rconConnection = new RconConnection();
const gcpManager = new GcpManager();

const app = express();

app.use(json()); // Parse JSON request bodies
let matchData = {};
const ajv = new Ajv();
const schemaPath = path.join(__dirname, 'schema.json');
console.log('Schema path:', schemaPath);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

// PostgreSQL connection details with explicit pool limits to prevent connection exhaustion

let pool = null;
const TEST_MODE = process.env.NODE_ENV === 'test';
const STATS_SOURCE_TABLES = [
  'demos',
  'matches',
  'players',
  'teams',
  'rounds',
  'kills',
  'clutches',
  'damages',
  'shots',
  'player_blinds',
  'smokes_start',
];
const STATS_POLL_INTERVAL_MS = Number(process.env.STATS_POLL_INTERVAL_MS || 15000);
const STATS_QUIET_PERIOD_MS = Number(process.env.STATS_QUIET_PERIOD_MS || 30000);
if (!TEST_MODE) {
  pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: 5432,
    max: 10,                       // Needs headroom for staggered stats batches (4) + aggregates + live routes + scheduler
    idleTimeoutMillis: 120000,     // Keep connections alive between 60s polls (was 30s — shorter than poll interval, so every poll created a new connection)
    connectionTimeoutMillis: 30000 // Allow time for connections when parallel queries contend
  });
}

function normalizeStatsStateRow(row) {
  if (!row) return null;
  return {
    dirty: Boolean(row.dirty),
    status: row.status || 'idle',
    sourceTable: row.source_table || null,
    currentVersion: Number(row.current_version || 0),
    lastMutationAt: row.last_mutation_at ? new Date(row.last_mutation_at) : null,
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    lastError: row.last_error || null,
  };
}

function writeTestStatsState(state) {
  if (!TEST_MODE || !state) return;
  global.__testStatsState = {
    dirty: Boolean(state.dirty),
    status: state.status || 'idle',
    source_table: state.sourceTable || null,
    current_version: Number(state.currentVersion || 0),
    last_mutation_at: state.lastMutationAt ? new Date(state.lastMutationAt) : null,
    last_completed_at: state.lastCompletedAt ? new Date(state.lastCompletedAt) : null,
    updated_at: state.updatedAt ? new Date(state.updatedAt) : null,
    last_error: state.lastError || null,
  };
}

async function fetchStatsRefreshStateFromDB() {
  if (TEST_MODE) {
    if (!global.__testStatsState) {
      const completedAt = new Date(Date.now() - 60000);
      global.__testStatsState = {
        dirty: false,
        status: 'idle',
        source_table: 'test',
        current_version: 1,
        last_mutation_at: completedAt,
        last_completed_at: completedAt,
        updated_at: completedAt,
        last_error: null,
      };
    }
    return normalizeStatsStateRow(global.__testStatsState);
  }

  try {
    const result = await pool.query(`
      SELECT dirty, status, source_table, current_version, last_mutation_at, last_completed_at, updated_at, last_error
      FROM stats_refresh_state
      WHERE id = 1
      LIMIT 1;
    `);
    return normalizeStatsStateRow(result.rows[0] || null);
  } catch (e) {
    console.error('[stats-state] Failed to fetch stats_refresh_state:', e.message);
    return null;
  }
}

function shouldPublishStats(state) {
  return Boolean(
    state?.dirty &&
    state?.status !== 'generating' &&
    state.lastMutationAt &&
    (Date.now() - state.lastMutationAt.getTime()) >= STATS_QUIET_PERIOD_MS
  );
}

let cachedStatsState = null;
let lastStatsStatePollAt = null;
let lastStatsStatePollError = null;
let lastStatsStateSource = 'uninitialized';
let statsRefreshManagerReady = false;
let backendListening = false;
let prewarmFrontendStatsSnapshot = async () => false;

async function pollStatsState() {
  lastStatsStatePollAt = new Date();
  try {
    const state = await fetchStatsRefreshStateFromDB();
    if (state) {
      cachedStatsState = state;
      lastStatsStatePollError = null;
      lastStatsStateSource = 'poller';
      if (statsRefreshManagerReady && shouldPublishStats(state)) {
        void triggerBackgroundStatsRefresh('dirty-state-poller', state);
      }
    } else {
      lastStatsStatePollError = 'stats_refresh_state query returned no value';
      lastStatsStateSource = 'poller-empty';
    }
    // Keep live_version + attendance table pages warm in PG buffer cache.
    // Without this, after days of inactivity PG evicts these pages and the
    // first /live/attendance request stalls waiting for disk I/O.
    if (pool) {
      pool.query(`SELECT version FROM live_version WHERE key = 'attendance'`).catch(() => {});
    }
  } catch (e) {
    lastStatsStatePollError = e.message;
    lastStatsStateSource = 'poller-error';
    console.error('[stats-state] Error polling stats_refresh_state:', e.message);
  }
}

function getCachedStatsState() {
  if (TEST_MODE) return fetchStatsRefreshStateFromDB();
  return cachedStatsState;
}

async function getStatsStateWithFallback() {
  const cachedState = TEST_MODE ? await getCachedStatsState() : getCachedStatsState();
  if (cachedState) {
    return { state: cachedState, source: TEST_MODE ? 'test' : 'cache' };
  }

  if (!pool) {
    return { state: null, source: 'no-pool' };
  }

  try {
    const freshState = await fetchStatsRefreshStateFromDB();
    lastStatsStatePollAt = new Date();
    if (!freshState) {
      lastStatsStatePollError = 'stats_refresh_state query returned no value';
      lastStatsStateSource = 'live-fallback-empty';
      return { state: null, source: 'live-fallback-empty' };
    }

    cachedStatsState = freshState;
    lastStatsStatePollError = null;
    lastStatsStateSource = 'live-fallback';
    return { state: cachedStatsState, source: 'live-fallback' };
  } catch (e) {
    lastStatsStatePollAt = new Date();
    lastStatsStatePollError = e.message;
    lastStatsStateSource = 'live-fallback-error';
    console.error('[stats-state] Live fallback failed:', e.message);
    return { state: null, source: 'live-fallback-error' };
  }
}

function getPublishedStatsVersion() {
  return cachedStatsState?.currentVersion || 0;
}

function getPublishedStatsTimestamp() {
  return cachedStatsState?.lastCompletedAt || null;
}

// Start background poller (only in production)
if (!TEST_MODE) {
  pollStatsState().then(() => {
    console.log('[stats-state] Initial state:', cachedStatsState);
  });
  setInterval(pollStatsState, STATS_POLL_INTERVAL_MS);
}

const { generateAll, generateAggregates, clearHistoricalCache } = require('./statsGenerator');
const notificationScheduler = require('./notificationScheduler');
const liveRoutes = require('./liveRoutes');
const notificationInboxRoutes = require('./notificationInboxRoutes');
const notificationInboxStore = require('./notificationInboxStore');
const notificationRoutes = require('./notificationRoutes');

// --- Per-IP rate limiting ---
// Simple in-memory rate limiter to prevent abuse. No external dependencies needed.
const rateLimitMap = new Map(); // ip -> { count, resetTime }
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 30;      // max requests per window per IP

function rateLimiter(req, res, next) {
  // Skip rate limiting for /live/ polling endpoints — they are high-frequency by design
  // and all frontend proxy traffic shares the same Docker-internal IP.
  if (req.path.startsWith('/live/')) return next();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`[rate-limit] IP ${ip} exceeded ${RATE_LIMIT_MAX_REQUESTS} req/min (count: ${entry.count})`);
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
}

// Clean up stale entries every 5 minutes to prevent memory leak
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);
if (typeof rateLimitCleanupTimer.unref === 'function') {
  rateLimitCleanupTimer.unref();
}

app.use(rateLimiter);

// --- Auth middleware for non-GET requests ---
// Placed BEFORE all route handlers so POST endpoints (including /stats/force-regenerate) are protected.
app.use((req, res, next) => {
  if (req.method === 'GET') {
    return next();
  }

  const apiKey = req.headers['authorization'];

  // Check if the Authorization header is present and starts with 'Bearer '
  if (!apiKey || !apiKey.startsWith('Bearer ')) {
    console.warn(`[auth] Rejected ${req.method} ${req.path} — no/invalid auth header`);
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // Extract the token after 'Bearer ' and compare it with the environment variable
  const token = apiKey.split(' ')[1];
  if (token !== process.env.AUTH_TOKEN) {
    console.warn(`[auth] Rejected ${req.method} ${req.path} — invalid token`);
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
});

let cachedSeasonConfig = resolveSeasonConfig();
let cachedSeasonStart = cachedSeasonConfig.seasonStart;
let cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
async function runStatsUpdateScript() {
  if (TEST_MODE) {
    return { stdout: 'test-mode skip', data: { night_avg: {} } };
  }
  // Re-resolve season start each generation in case file changed
  cachedSeasonConfig = resolveSeasonConfig();
  cachedSeasonStart = cachedSeasonConfig.seasonStart;
  cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
  const datasets = await generateAll(pool, { seasonStart: cachedSeasonStart, seasonStarts: cachedSeasonStarts });
  return { stdout: 'ok', data: datasets };
}

// Concurrency lock so only one generation runs at a time
let statsGenerationPromise = null;
let lastGeneratedServerTimestamp = null;
let lastGeneratedStatsVersion = 0;
let lastGeneratedData = null; // cache of last generated datasets — kept in memory permanently (~4 MB, 3% of 128 MB heap)


let frontendPrewarmPromise = null;

function applyGeneratedSnapshot(data, statsState) {
  lastGeneratedData = data;
  lastAggregateData = pickAggregateSnapshot(data);
  if (statsState) {
    lastGeneratedStatsVersion = Number(statsState.currentVersion || 0);
    lastAggregateStatsVersion = Number(statsState.currentVersion || 0);
    if (statsState.lastCompletedAt) {
      lastGeneratedServerTimestamp = new Date(statsState.lastCompletedAt);
      lastAggregateServerTimestamp = new Date(statsState.lastCompletedAt);
    }
  }
}

function buildStatsMeta(statsState) {
  return {
    statsVersion: Number(statsState?.currentVersion || 0),
    serverTimestamp: statsState?.lastCompletedAt ? new Date(statsState.lastCompletedAt).toISOString() : null,
  };
}

async function setStatsRefreshStatus(status, lastError = null) {
  if (TEST_MODE) {
    if (!cachedStatsState) return null;
    cachedStatsState = {
      ...cachedStatsState,
      status,
      lastError,
      updatedAt: new Date(),
    };
    writeTestStatsState(cachedStatsState);
    return cachedStatsState;
  }

  const result = await pool.query(
    `UPDATE stats_refresh_state
     SET status = $2,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING dirty, status, source_table, current_version, last_mutation_at, last_completed_at, updated_at, last_error`,
    [1, status, lastError]
  );
  cachedStatsState = normalizeStatsStateRow(result.rows[0] || null);
  return cachedStatsState;
}

async function completeStatsPublish(expectedMutationAt, sourceTable, force = false) {
  if (TEST_MODE) {
    const baseState = cachedStatsState || await fetchStatsRefreshStateFromDB() || {};
    cachedStatsState = {
      ...baseState,
      dirty: false,
      status: 'idle',
      sourceTable: sourceTable || baseState.sourceTable || null,
      currentVersion: Number(baseState.currentVersion || 0) + 1,
      lastCompletedAt: new Date(),
      updatedAt: new Date(),
      lastError: null,
    };
    writeTestStatsState(cachedStatsState);
    return cachedStatsState;
  }

  const params = [1, sourceTable || null];
  let query = `
    UPDATE stats_refresh_state
    SET dirty = false,
        status = 'idle',
        source_table = COALESCE($2, source_table),
        current_version = current_version + 1,
        last_completed_at = NOW(),
        updated_at = NOW(),
        last_error = NULL
    WHERE id = $1`;

  if (!force) {
    params.push(expectedMutationAt ? new Date(expectedMutationAt).toISOString() : null);
    query += ` AND dirty = true AND last_mutation_at IS NOT DISTINCT FROM $3::timestamptz`;
  }

  query += ` RETURNING dirty, status, source_table, current_version, last_mutation_at, last_completed_at, updated_at, last_error`;
  const result = await pool.query(query, params);
  const publishedState = normalizeStatsStateRow(result.rows[0] || null);
  if (publishedState) {
    cachedStatsState = publishedState;
  }
  return publishedState;
}

async function runStatsGenerationWithLock(reason) {
  if (!statsGenerationPromise) {
    console.log(`[stats-refresh] ${reason}: starting stats generation`);
    statsGenerationPromise = runStatsUpdateScript().finally(() => { statsGenerationPromise = null; });
  } else {
    console.log(`[stats-refresh] ${reason}: reusing in-flight stats generation`);
  }
  return statsGenerationPromise;
}

async function triggerBackgroundStatsRefresh(reason, targetState = null, options = {}) {
  const force = Boolean(options.force);
  const effectiveState = targetState || cachedStatsState;
  if (!force && !shouldPublishStats(effectiveState)) {
    return false;
  }

  if (!force && lastGeneratedData && lastGeneratedStatsVersion === Number(effectiveState?.currentVersion || 0) + 1) {
    return false;
  }

  try {
    await setStatsRefreshStatus('generating', null);
    const expectedMutationAt = effectiveState?.lastMutationAt ? new Date(effectiveState.lastMutationAt) : null;
    const result = await runStatsGenerationWithLock(reason);
    const publishedState = await completeStatsPublish(expectedMutationAt, effectiveState?.sourceTable || reason, force);
    if (!publishedState) {
      const latest = await fetchStatsRefreshStateFromDB();
      cachedStatsState = latest;
      console.log(`[stats-refresh] ${reason}: source changed during generation, keeping dirty state for retry`);
      return false;
    }
    applyGeneratedSnapshot(result.data, publishedState);
    if (backendListening) {
      void prewarmFrontendStatsSnapshot();
    }
    console.log(`[stats-refresh] ${reason}: published stats version ${publishedState.currentVersion}`);
    return true;
  } catch (e) {
    try {
      await setStatsRefreshStatus('dirty', e.message);
    } catch {}
    console.error(`[stats-refresh] ${reason}: background full stats refresh failed`, e.message);
    return false;
  }
}

async function hydratePublishedSnapshot(reason, statsState) {
  if (!statsState) return false;
  if (lastGeneratedData && lastGeneratedStatsVersion === Number(statsState.currentVersion || 0)) {
    return true;
  }
  try {
    const result = await runStatsGenerationWithLock(reason);
    applyGeneratedSnapshot(result.data, statsState);
    return true;
  } catch (e) {
    console.error(`[stats-refresh] ${reason}: failed to hydrate published snapshot`, e.message);
    return false;
  }
}

function pickAggregateSnapshot(fullData) {
  if (!fullData || typeof fullData !== 'object') return null;
  return {
    season_avg: fullData.season_avg,
    season_avg_periods: fullData.season_avg_periods,
    last10: fullData.last10,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Aggregates endpoint: recompute only when DB data has changed (or on cold start).
// Uses the same published stats version as /stats/incremental to avoid unnecessary DB work.
let lastAggregateServerTimestamp = null;
let lastAggregateStatsVersion = 0;
let lastAggregateData = null; // cached aggregate result
let aggregateGenerationPromise = null; // concurrency lock

app.get('/stats/aggregates', async (req, res) => {
  try {
    const { state: statsState } = await getStatsStateWithFallback();
    const statsMeta = buildStatsMeta(statsState);
    const publishedVersion = Number(statsState?.currentVersion || 0);
    const versionUnchanged = lastAggregateStatsVersion === publishedVersion;

    if (publishedVersion <= 0) {
      res.set('Cache-Control', 'no-store');
      return res.json({ updated: false, ...statsMeta });
    }

    if (versionUnchanged) {
      if (lastAggregateData) {
        res.set('Cache-Control','no-store');
        return res.json({ updated: true, ...statsMeta, ...lastAggregateData });
      }
      res.set('Cache-Control','no-store');
      return res.json({ updated: false, ...statsMeta });
    }

    if (statsState?.dirty) {
      res.set('Cache-Control', 'no-store');
      return res.json({ updated: false, ...statsMeta });
    }

    if (!aggregateGenerationPromise) {
      aggregateGenerationPromise = (async () => {
        cachedSeasonConfig = resolveSeasonConfig();
        cachedSeasonStart = cachedSeasonConfig.seasonStart;
        cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
        return await generateAggregates(pool, { seasonStart: cachedSeasonStart, seasonStarts: cachedSeasonStarts });
      })().finally(() => { aggregateGenerationPromise = null; });
    }
    const agg = await aggregateGenerationPromise;
    lastAggregateStatsVersion = publishedVersion;
    if (statsState?.lastCompletedAt) lastAggregateServerTimestamp = new Date(statsState.lastCompletedAt);
    lastAggregateData = agg;
    res.set('Cache-Control','no-store');
    res.json({ updated: true, ...statsMeta, ...agg });
  } catch (e) {
    console.error('Error in /stats/aggregates', e);
    res.status(500).json({ error: 'aggregates_failed', details: e.message });
  }
});

// Incremental endpoint: supply lastKnownVersion; if no new published snapshot exists,
// respond updated:false with version metadata only.
app.get('/stats/incremental', async (req, res) => {
  try {
    const rawClientVersion = typeof req.query.lastKnownVersion === 'string'
      ? req.query.lastKnownVersion
      : null;
    const legacyClientTs = typeof req.query.lastKnownTs === 'string'
      ? req.query.lastKnownTs
      : null;
    const { state: statsState, source: stateSource } = await getStatsStateWithFallback();
    if (!statsState) {
      console.warn('[stats/incremental] stats_refresh_state unavailable (source:', stateSource, ')');
      return res.status(503).json({ error: 'stats_state_unavailable' });
    }
    const statsMeta = buildStatsMeta(statsState);
    const publishedVersion = Number(statsState.currentVersion || 0);
    const clientVersion = rawClientVersion && /^\d+$/.test(rawClientVersion)
      ? Number(rawClientVersion)
      : (legacyClientTs && statsMeta.serverTimestamp === legacyClientTs ? publishedVersion : 0);
    if (publishedVersion <= clientVersion) {
      res.set('Cache-Control', 'no-store');
      return res.json({ updated: false, ...statsMeta });
    }

    if (!statsState.dirty && (!lastGeneratedData || lastGeneratedStatsVersion !== publishedVersion)) {
      await hydratePublishedSnapshot('incremental-hydrate', statsState);
    }

    if (!lastGeneratedData || lastGeneratedStatsVersion !== publishedVersion) {
      res.set('Cache-Control', 'no-store');
      return res.json({ updated: false, ...statsMeta });
    }

    res.set('Cache-Control','no-store');
    res.json({ updated: true, ...statsMeta, ...lastGeneratedData });
  } catch (e) {
    console.error('Error in /stats/incremental', e);
    res.status(500).json({ error: 'internal', details: e.message });
  }
});

// Force regeneration endpoint (for admin use)
// This bypasses timestamp checks and always regenerates + returns full data
app.post('/stats/force-regenerate', async (req, res) => {
  try {
    console.log('[force-regenerate] Manual regeneration triggered');
    const { state: currentStatsState } = await getStatsStateWithFallback();
    // Clear cached versions to force regeneration of both full & aggregates
    lastGeneratedStatsVersion = 0;
    lastGeneratedServerTimestamp = null;
    lastAggregateStatsVersion = 0;
    lastAggregateServerTimestamp = null;
    lastAggregateData = null;
    clearHistoricalCache();
    const success = await triggerBackgroundStatsRefresh('force-regenerate', currentStatsState, { force: true });
    if (!success || !lastGeneratedData) {
      return res.status(500).json({ error: 'regeneration_failed', details: 'manual publish did not complete' });
    }
    const statsMeta = buildStatsMeta(cachedStatsState);
    res.json({ 
      success: true, 
      updated: true,
      message: 'Stats regenerated successfully',
      ...statsMeta,
      ...lastGeneratedData
    });
  } catch (e) {
    console.error('Error in force regenerate', e);
    res.status(500).json({ error: 'regeneration_failed', details: e.message });
  }
});

// Lightweight diagnostics endpoint to help debug missing data
app.get('/stats/diagnostics', async (req, res) => {
  try {
    const { state: effectiveStatsState, source: effectiveStatsStateSource } = await getStatsStateWithFallback();
    const seasonStart = cachedSeasonStart;
    const seasonStarts = cachedSeasonStarts;
    let counts = {};
    if (lastGeneratedData) {
      counts = {
        season_avg: Array.isArray(lastGeneratedData.season_avg)? lastGeneratedData.season_avg.length : 0,
        season_avg_periods: lastGeneratedData.season_avg_periods ? Object.keys(lastGeneratedData.season_avg_periods.data || {}).length : 0,
        night_avg_dates: lastGeneratedData.night_avg ? Object.keys(lastGeneratedData.night_avg).length : 0,
        night_avg_all_dates: lastGeneratedData.night_avg_all ? Object.keys(lastGeneratedData.night_avg_all).length : 0,
        last10: Array.isArray(lastGeneratedData.last10)? lastGeneratedData.last10.length : 0,
        sonmac_dates: lastGeneratedData.sonmac_by_date ? Object.keys(lastGeneratedData.sonmac_by_date).length : 0,
        sonmac_all_dates: lastGeneratedData.sonmac_by_date_all ? Object.keys(lastGeneratedData.sonmac_by_date_all).length : 0,
        duello_son_mac_rows: lastGeneratedData.duello_son_mac ? lastGeneratedData.duello_son_mac.playerRows?.length : 0,
        duello_sezon_rows: lastGeneratedData.duello_sezon ? lastGeneratedData.duello_sezon.playerRows?.length : 0,
        performance_players: Array.isArray(lastGeneratedData.performance_data)? lastGeneratedData.performance_data.length : 0,
        players_stats: Array.isArray(lastGeneratedData.players_stats)? lastGeneratedData.players_stats.length : 0,
        players_stats_periods: lastGeneratedData.players_stats_periods ? Object.keys(lastGeneratedData.players_stats_periods.data || {}).length : 0,
        map_stats: Array.isArray(lastGeneratedData.map_stats)? lastGeneratedData.map_stats.length : 0,
        errors: lastGeneratedData.__errors || []
      };
    }
    res.json({
      seasonStart,
      seasonStarts,
      cachedStatsState: cachedStatsState ? {
        dirty: cachedStatsState.dirty,
        status: cachedStatsState.status,
        sourceTable: cachedStatsState.sourceTable,
        currentVersion: cachedStatsState.currentVersion,
        lastMutationAt: cachedStatsState.lastMutationAt ? cachedStatsState.lastMutationAt.toISOString() : null,
        lastCompletedAt: cachedStatsState.lastCompletedAt ? cachedStatsState.lastCompletedAt.toISOString() : null,
        lastError: cachedStatsState.lastError,
      } : null,
      effectiveStatsState: effectiveStatsState ? {
        dirty: effectiveStatsState.dirty,
        status: effectiveStatsState.status,
        sourceTable: effectiveStatsState.sourceTable,
        currentVersion: effectiveStatsState.currentVersion,
        lastMutationAt: effectiveStatsState.lastMutationAt ? effectiveStatsState.lastMutationAt.toISOString() : null,
        lastCompletedAt: effectiveStatsState.lastCompletedAt ? effectiveStatsState.lastCompletedAt.toISOString() : null,
        lastError: effectiveStatsState.lastError,
      } : null,
      effectiveStatsStateSource,
      lastStatsStatePollAt: lastStatsStatePollAt ? lastStatsStatePollAt.toISOString() : null,
      lastStatsStatePollError,
      lastStatsStateSource,
      lastGeneratedStatsVersion,
      lastGeneratedServerTimestamp: lastGeneratedServerTimestamp ? new Date(lastGeneratedServerTimestamp).toISOString() : null,
      counts,
    });
  } catch (e) {
    res.status(500).json({ error: 'diagnostics_failed', details: e.message });
  }
});

// NOTE: Auth middleware for POST requests has been moved above (before route definitions)
// to ensure ALL POST endpoints including /stats/force-regenerate are protected.

// --- Live state routes (attendance + team picker + MVP + batak) ---
// GET endpoints are open (polling); POST endpoints are protected by auth middleware above.
if (pool) {
  liveRoutes.setup(pool);
  notificationInboxStore.setup(pool);
  notificationRoutes.setup(pool);
  app.use('/live', liveRoutes.router);
  app.use('/live/notifications/inbox', notificationInboxRoutes.router);
  app.use('/live/notifications', notificationRoutes.router);

  // Admin check — lightweight GET, no auth middleware (only returns boolean)
  app.get('/admin/check/:email', async (req, res) => {
    try {
      const { email } = req.params;
      if (!email) return res.json({ isAdmin: false });
      const r = await pool.query(
        `SELECT is_admin FROM admins WHERE email = $1 AND is_admin = true`,
        [email]
      );
      res.json({ isAdmin: r.rows.length > 0 });
    } catch (e) {
      console.error('[admin/check]', e.message);
      res.json({ isAdmin: false });
    }
  });
}

// POST  endpoint to store a match json and stores in the memory until the GET end point is called
app.post('/start-match', async (req, res) => {
  try {
    const match = req.body; // Get the match from the request body
    // check if the match is compliant with the JSON schema at schema.json
    console.log('Match:', match);
    const valid = validate(match);
    if (!valid) {
      return res.status(400).json({ error: 'Match is not compliant with the schema.', details: validate.errors });
    } 
    matchData = match;
    await rconConnection.startMatch();

    res.json({ message: 'Match stored successfully' });
  } catch (err) {
    console.error('Error parsing request body:', err);
    res.status(400).json({ error: 'Failed to parse request body.', details: err.message });
  }
});

// POST endpoint to load all plugins on the RCON server
app.post('/load-plugins', async (req, res) => {
  try {
    await rconConnection.loadAllPlugins();
    res.json({ message: 'Plugins load command executed' });
  } catch (err) {
    console.error('Error loading plugins via RCON:', err);
    res.status(500).json({ error: 'Failed to load plugins', details: err.message });
  }
});

// GET endpoint to retrieve the stored match json
app.get('/get-match', async (req, res) => {
  try {
    res.json(matchData);
    matchData = {};
  } catch (err) {
    console.error('Error parsing request body:', err);
    res.status(400).json({ error: 'Failed to parse request body.', details: err.message });
  }
});

// POST endpoint to start a GCP VM
app.post('/start-vm', async (req, res) => {
  try {
    console.log('Starting GCP VM');
    const result = await gcpManager.startVm();

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(500).json({ error: 'Failed to start VM', details: result.error });
    }
  } catch (err) {
    console.error('Error starting VM:', err);
    res.status(500).json({ error: 'Failed to start VM', details: err.message });
  }
});

// POST endpoint to stop a GCP VM
app.post('/stop-vm', async (req, res) => {
  try {
    console.log('Stopping GCP VM');
    const result = await gcpManager.stopVm();

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(500).json({ error: 'Failed to stop VM', details: result.error });
    }
  } catch (err) {
    console.error('Error stopping VM:', err);
    res.status(500).json({ error: 'Failed to stop VM', details: err.message });
  }
});

// Start the server
if (!TEST_MODE) {
  const port = process.env.PORT || 3000;

  // Auto-apply idempotent schema migrations on startup
  async function runMigrations() {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS stats_refresh_state (
         id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
         dirty BOOLEAN NOT NULL DEFAULT false,
         status TEXT NOT NULL DEFAULT 'idle',
         source_table TEXT,
         current_version BIGINT NOT NULL DEFAULT 0,
         last_mutation_at TIMESTAMPTZ,
         last_completed_at TIMESTAMPTZ,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_error TEXT
       )`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stats_refresh_state' AND column_name='dirty') THEN ALTER TABLE stats_refresh_state ADD COLUMN dirty BOOLEAN NOT NULL DEFAULT false; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stats_refresh_state' AND column_name='status') THEN ALTER TABLE stats_refresh_state ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stats_refresh_state' AND column_name='current_version') THEN ALTER TABLE stats_refresh_state ADD COLUMN current_version BIGINT NOT NULL DEFAULT 0; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stats_refresh_state' AND column_name='last_mutation_at') THEN ALTER TABLE stats_refresh_state ADD COLUMN last_mutation_at TIMESTAMPTZ; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stats_refresh_state' AND column_name='last_completed_at') THEN ALTER TABLE stats_refresh_state ADD COLUMN last_completed_at TIMESTAMPTZ; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stats_refresh_state' AND column_name='last_error') THEN ALTER TABLE stats_refresh_state ADD COLUMN last_error TEXT; END IF; END $$`,
      `CREATE OR REPLACE FUNCTION touch_stats_refresh_state() RETURNS TRIGGER AS $$ BEGIN INSERT INTO stats_refresh_state (id, dirty, status, source_table, last_mutation_at, updated_at, last_error) VALUES (1, true, 'dirty', TG_TABLE_NAME, NOW(), NOW(), NULL) ON CONFLICT (id) DO UPDATE SET dirty = true, status = 'dirty', source_table = EXCLUDED.source_table, last_mutation_at = EXCLUDED.last_mutation_at, updated_at = EXCLUDED.updated_at, last_error = NULL; RETURN NULL; END; $$ LANGUAGE plpgsql`,
      `INSERT INTO stats_refresh_state (id, dirty, status, source_table, current_version, last_mutation_at, updated_at)
       SELECT 1,
              true,
              'dirty',
              'bootstrap',
              0,
              COALESCE((SELECT MAX(date) FROM demos), NOW()),
              NOW()
       ON CONFLICT (id) DO NOTHING`,
      // Live state tables (attendance + team picker) — replaces Firebase RTDB
      `CREATE TABLE IF NOT EXISTS attendance (steam_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'no_response', emoji_status TEXT NOT NULL DEFAULT 'normal', is_kaptan BOOLEAN NOT NULL DEFAULT FALSE, kaptan_timestamp BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS team_picker (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), team_a_players JSONB NOT NULL DEFAULT '{}', team_b_players JSONB NOT NULL DEFAULT '{}', team_a_name_mode TEXT NOT NULL DEFAULT 'generic', team_b_name_mode TEXT NOT NULL DEFAULT 'generic', team_a_captain TEXT NOT NULL DEFAULT '', team_b_captain TEXT NOT NULL DEFAULT '', team_a_kabile TEXT NOT NULL DEFAULT '', team_b_kabile TEXT NOT NULL DEFAULT '', maps JSONB NOT NULL DEFAULT '{}', overrides JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `INSERT INTO team_picker (id) VALUES (1) ON CONFLICT DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS live_version (key TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0)`,
      `INSERT INTO live_version (key, version) VALUES ('attendance', 0), ('team_picker', 0), ('mvp_votes', 0), ('batak_captains', 0), ('batak_super_kupa', 0) ON CONFLICT DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS notification_inbox (id TEXT PRIMARY KEY, user_uid TEXT NOT NULL, topic TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data JSONB, read BOOLEAN NOT NULL DEFAULT FALSE, deleted BOOLEAN NOT NULL DEFAULT FALSE, created_at BIGINT NOT NULL, event_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_inbox' AND column_name='deleted') THEN ALTER TABLE notification_inbox ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE; END IF; END $$`,
      `CREATE INDEX IF NOT EXISTS notification_inbox_user_created_idx ON notification_inbox (user_uid, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS notification_inbox_version (user_uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // MVP voting tables — replaces Firebase RTDB mvpVotes/*
      `CREATE TABLE IF NOT EXISTS mvp_votes (date TEXT NOT NULL, voter_steam_id TEXT NOT NULL, voted_for_steam_id TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (date, voter_steam_id))`,
      `CREATE TABLE IF NOT EXISTS mvp_locks (date TEXT PRIMARY KEY, locked BOOLEAN NOT NULL DEFAULT TRUE, locked_by_uid TEXT, locked_by_name TEXT, locked_at BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // Batak AllStars tables — replaces Firebase RTDB batakAllStars/*
      `CREATE TABLE IF NOT EXISTS batak_captains (date TEXT NOT NULL, team_key TEXT NOT NULL, steam_id TEXT NOT NULL, steam_name TEXT, team_name TEXT, set_by_uid TEXT, set_by_name TEXT, set_at BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (date, team_key))`,
      `CREATE TABLE IF NOT EXISTS batak_super_kupa (slot TEXT PRIMARY KEY, player1_steam_id TEXT NOT NULL, player1_name TEXT NOT NULL, player1_league TEXT NOT NULL, player2_steam_id TEXT NOT NULL, player2_name TEXT NOT NULL, player2_league TEXT NOT NULL, winner_steam_id TEXT, score TEXT, date TEXT, set_by_uid TEXT, set_by_name TEXT, set_at BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // Admin table — email-based admin lookup
      `CREATE TABLE IF NOT EXISTS admins (email TEXT PRIMARY KEY, is_admin BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // Notification preferences — replaces Firebase RTDB notifications/preferences/{uid}
      `CREATE TABLE IF NOT EXISTS notification_preferences (uid TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT TRUE, topics JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // Notification subscriptions — replaces Firebase RTDB notifications/subscriptions/{uid}/{deviceId}
      `CREATE TABLE IF NOT EXISTS notification_subscriptions (uid TEXT NOT NULL, device_id TEXT NOT NULL, token TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, platform TEXT, user_agent TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (uid, device_id))`,
      // Notification events — replaces Firebase RTDB notifications/events/{eventId}
      `CREATE TABLE IF NOT EXISTS notification_events (event_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', topic TEXT, title TEXT, body TEXT, data JSONB, created_by_uid TEXT, created_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ, failed_at TIMESTAMPTZ, recipient_count INT, success_count INT, failure_count INT, errors JSONB, error TEXT)`,
    ];
    for (const tableName of STATS_SOURCE_TABLES) {
      migrations.push(
        `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='${tableName}') AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='${tableName}_stats_refresh_touch') THEN CREATE TRIGGER ${tableName}_stats_refresh_touch AFTER INSERT OR UPDATE OR DELETE ON ${tableName} FOR EACH STATEMENT EXECUTE FUNCTION touch_stats_refresh_state(); END IF; END $$`
      );
    }
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { console.warn('[migration]', e.message); }
    }
    console.log('[migration] schema migrations applied');
  }

  // Run migrations, load config, then fully warm stats before the backend starts
  // accepting traffic. This avoids making the first post-deploy user request pay
  // the heavy generation cost for sonmac/night_avg and friends.
  async function warmStartup() {
    try {
      await runMigrations();
      cachedSeasonConfig = resolveSeasonConfig();
      cachedSeasonStart = cachedSeasonConfig.seasonStart;
      cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
      await pollStatsState();
      const startedAt = Date.now();
      if (cachedStatsState?.currentVersion > 0 && !cachedStatsState.dirty) {
        console.log(`[startup] hydrating published stats version ${cachedStatsState.currentVersion} into memory`);
        await hydratePublishedSnapshot('startup-hydrate', cachedStatsState);
        console.log(`[startup] published stats hydration complete in ${Date.now() - startedAt}ms`);
      } else if (shouldPublishStats(cachedStatsState)) {
        console.log('[startup] dirty stats state is quiet enough; publishing initial snapshot');
        await triggerBackgroundStatsRefresh('startup-initial', cachedStatsState);
        console.log(`[startup] initial stats publish complete in ${Date.now() - startedAt}ms`);
      } else {
        console.log('[startup] waiting for quiet window before publishing stats', cachedStatsState);
      }
    } catch (e) {
      console.warn('[startup] warmStartup failed (will retry on first request)', e.message);
    }
  }

  prewarmFrontendStatsSnapshot = async function prewarmFrontendStatsSnapshotImpl() {
    if (frontendPrewarmPromise) {
      return frontendPrewarmPromise;
    }

    const frontendBase = process.env.FRONTEND_INTERNAL_URL || 'http://frontend-nextjs:3000';
    const authToken = process.env.MATCHMAKING_TOKEN;
    const attempts = Number(process.env.FRONTEND_PREWARM_ATTEMPTS || 15);
    const retryMs = Number(process.env.FRONTEND_PREWARM_RETRY_MS || 5000);
    const timeoutMs = Number(process.env.FRONTEND_PREWARM_TIMEOUT_MS || 10000);

    if (!authToken) {
      console.warn('[startup] frontend stats prewarm skipped: MATCHMAKING_TOKEN is not configured');
      return false;
    }

    frontendPrewarmPromise = (async () => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const ac = new AbortController();
          const timeout = setTimeout(() => ac.abort(), timeoutMs);
          let res;
          try {
            res = await fetch(`${frontendBase}/api/internal/stats/prewarm`, {
              method: 'POST',
              signal: ac.signal,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
            });
          } finally {
            clearTimeout(timeout);
          }
          if (res.ok) {
            const body = await res.json().catch(() => null);
            console.log('[startup] frontend stats snapshot prewarmed', {
              attempt,
              updated: body?.updated ?? null,
              filesWritten: Array.isArray(body?.filesWritten) ? body.filesWritten.length : 0,
              serverTimestamp: body?.serverTimestamp ?? null,
            });
            return true;
          }
          const text = await res.text().catch(() => '');
          console.warn(`[startup] frontend stats prewarm attempt ${attempt}/${attempts} failed with status ${res.status}: ${text}`);
        } catch (e) {
          console.warn(`[startup] frontend stats prewarm attempt ${attempt}/${attempts} failed: ${e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message}`);
        }
        if (attempt < attempts) {
          await sleep(retryMs);
        }
      }

      console.warn('[startup] frontend stats snapshot prewarm exhausted; runtime-data will refresh on normal traffic');
      return false;
    })().finally(() => {
      frontendPrewarmPromise = null;
    });

    return frontendPrewarmPromise;
  };

  (async () => {
    await warmStartup();
    app.listen(port, () => {
      backendListening = true;
      statsRefreshManagerReady = true;
      console.log(`Middleware is running on port ${port}`);

      // Start the notification scheduler after the server is listening.
      // It uses getPublishedStatsVersion() (in-memory, no DB cost) to detect stats changes.
      notificationScheduler.start({
        getPublishedStatsVersion,
        pool,
      });

      // Best-effort: once the backend cache is hot, refresh frontend runtime-data too.
      void prewarmFrontendStatsSnapshot();
    });
  })();
}
 
module.exports = app;

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

// Utility: get last updated date from critical tables (matches & players)
// This queries the DB directly – should only be called by the background poller,
// never in request hot paths.
async function fetchLastDataTimestampFromDB() {
  if (TEST_MODE) {
    // In test mode return a deterministic moving timestamp (increments per call)
    if (!global.__testLastTs) {
      global.__testLastTs = new Date(Date.now() - 60000); // 1 min ago
    } else {
      // Advance 1 second to emulate potential change
      global.__testLastTs = new Date(global.__testLastTs.getTime() + 1000);
    }
    return global.__testLastTs;
  }
  // Check demos.date (for new entries) and updated_at columns (for modifications).
  // Uses GREATEST to pick the most recent change across all tracked tables.
  // NOTE: Uses subqueries instead of LEFT JOIN ON TRUE to avoid cartesian product.
  const query = `
    SELECT GREATEST(
      COALESCE((SELECT MAX(date) FROM demos), '1970-01-01'::timestamp),
      COALESCE((SELECT MAX(updated_at) FROM matches), '1970-01-01'::timestamp),
      COALESCE((SELECT MAX(updated_at) FROM players), '1970-01-01'::timestamp)
    ) AS last_change;`;
  try {
    const r = await pool.query(query);
    return r.rows[0]?.last_change || null;
  } catch (e) {
    // Fallback 1: updated_at columns might not exist yet
    console.warn('[timestamp] Extended query failed, trying demos.date:', e.message);
    try {
      const fallback = await pool.query(`SELECT COALESCE(
        (SELECT MAX(date) FROM demos),
        '1970-01-01'::timestamp
      ) AS last_change;`);
      return fallback.rows[0]?.last_change || null;
    } catch (e2) {
      // Fallback 2: matches/demos tables might not have date column
      console.warn('[timestamp] Fallback 1 failed, trying demos.date only:', e2.message);
      try {
        const fallback2 = await pool.query(`SELECT COALESCE(MAX(date), '1970-01-01'::timestamp) AS last_change FROM demos;`);
        return fallback2.rows[0]?.last_change || null;
      } catch (e3) {
        // Fallback 3: check if any table has rows at all
        console.warn('[timestamp] Fallback 2 failed, trying table existence check:', e3.message);
        try {
          const exists = await pool.query(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'matches') AS has_matches`);
          if (exists.rows[0]?.has_matches) {
            // Table exists but we couldn't read timestamp — return epoch so stats always regenerate
            console.warn('[timestamp] matches table exists but timestamp queries failed. Using epoch fallback.');
            return new Date('1970-01-01T00:00:00Z');
          }
          console.error('[timestamp] No matches table found — CSDM data may not be imported');
          return null;
        } catch (e4) {
          console.error('[timestamp] All timestamp queries failed:', e4.message);
          return null;
        }
      }
    }
  }
}

// --- Cached timestamp poller ---
// The DB timestamp is polled in the background every 60s.
// All request handlers read from memory, ZERO DB cost per page load.
const DB_POLL_INTERVAL_MS = 60 * 1000; // 60 seconds
let cachedLastDataTimestamp = null; // in-memory cache of last DB data timestamp
let lastTimestampPollAt = null;
let lastTimestampPollError = null;
let lastTimestampSource = 'uninitialized';

async function pollDataTimestamp() {
  lastTimestampPollAt = new Date();
  try {
    const ts = await fetchLastDataTimestampFromDB();
    if (ts) {
      cachedLastDataTimestamp = new Date(ts);
      lastTimestampPollError = null;
      lastTimestampSource = 'poller';
    } else {
      lastTimestampPollError = 'timestamp query returned no value';
      lastTimestampSource = 'poller-empty';
    }
    // Keep live_version + attendance table pages warm in PG buffer cache.
    // Without this, after days of inactivity PG evicts these pages and the
    // first /live/attendance request stalls waiting for disk I/O.
    if (pool) {
      pool.query(`SELECT version FROM live_version WHERE key = 'attendance'`).catch(() => {});
    }
  } catch (e) {
    lastTimestampPollError = e.message;
    lastTimestampSource = 'poller-error';
    console.error('[timestamp-poller] Error polling DB timestamp:', e.message);
  }
}

// Returns the cached timestamp (never hits DB)
function getCachedDataTimestamp() {
  if (TEST_MODE) return fetchLastDataTimestampFromDB(); // test mode needs async per-call
  return cachedLastDataTimestamp;
}

async function getDataTimestampWithFallback() {
  const cachedTs = TEST_MODE ? await getCachedDataTimestamp() : getCachedDataTimestamp();
  if (cachedTs) {
    return { timestamp: cachedTs, source: TEST_MODE ? 'test' : 'cache' };
  }

  if (!pool) {
    return { timestamp: null, source: 'no-pool' };
  }

  try {
    const freshTs = await fetchLastDataTimestampFromDB();
    lastTimestampPollAt = new Date();
    if (!freshTs) {
      lastTimestampPollError = 'timestamp query returned no value';
      lastTimestampSource = 'live-fallback-empty';
      return { timestamp: null, source: 'live-fallback-empty' };
    }

    cachedLastDataTimestamp = new Date(freshTs);
    lastTimestampPollError = null;
    lastTimestampSource = 'live-fallback';
    return { timestamp: cachedLastDataTimestamp, source: 'live-fallback' };
  } catch (e) {
    lastTimestampPollAt = new Date();
    lastTimestampPollError = e.message;
    lastTimestampSource = 'live-fallback-error';
    console.error('[timestamp-poller] Live fallback failed:', e.message);
    return { timestamp: null, source: 'live-fallback-error' };
  }
}

// Start background poller (only in production)
if (!TEST_MODE) {
  // Initial poll on startup
  pollDataTimestamp().then(() => {
    console.log('[timestamp-poller] Initial DB timestamp:', cachedLastDataTimestamp);
  });
  setInterval(pollDataTimestamp, DB_POLL_INTERVAL_MS);
}

const { generateAll, generateAggregates, clearHistoricalCache } = require('./statsGenerator');
const notificationScheduler = require('./notificationScheduler');
const liveRoutes = require('./liveRoutes');
const notificationInboxRoutes = require('./notificationInboxRoutes');
const notificationInboxStore = require('./notificationInboxStore');

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
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

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
let lastGeneratedServerTimestamp = null; // tracks last successful generation based on server data timestamp
let lastGeneratedData = null; // cache of last generated datasets — kept in memory permanently (~4 MB, 3% of 128 MB heap)


// Aggregates endpoint: recompute only when DB data has changed (or on cold start).
// Uses the same in-memory cached timestamp as /stats/incremental to avoid unnecessary DB work.
let lastAggregateServerTimestamp = null; // tracks DB timestamp of last aggregate generation
let lastAggregateData = null; // cached aggregate result
let aggregateGenerationPromise = null; // concurrency lock

app.get('/stats/aggregates', async (req, res) => {
  try {
    const { timestamp: serverLastTs } = await getDataTimestampWithFallback();
    const serverDate = serverLastTs ? new Date(serverLastTs) : null;
    const dbUnchanged = serverDate && lastAggregateServerTimestamp &&
        serverDate.getTime() === new Date(lastAggregateServerTimestamp).getTime();

    // If DB hasn't changed since last generation, return cached data or skip
    if (dbUnchanged) {
      if (lastAggregateData) {
        res.set('Cache-Control','no-store');
        return res.json({ updated: true, serverTimestamp: serverDate.toISOString(), ...lastAggregateData });
      }
      // Cache expired but DB unchanged — frontend has data on disk, no need to regenerate
      res.set('Cache-Control','no-store');
      return res.json({ updated: false, serverTimestamp: serverDate.toISOString() });
    }

    // DB changed (or cold start) — regenerate with concurrency lock
    if (!aggregateGenerationPromise) {
      aggregateGenerationPromise = (async () => {
        cachedSeasonConfig = resolveSeasonConfig();
        cachedSeasonStart = cachedSeasonConfig.seasonStart;
        cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
        return await generateAggregates(pool, { seasonStart: cachedSeasonStart, seasonStarts: cachedSeasonStarts });
      })().finally(() => { aggregateGenerationPromise = null; });
    }
    const agg = await aggregateGenerationPromise;
    if (serverDate) lastAggregateServerTimestamp = serverDate;
    lastAggregateData = agg;
    res.set('Cache-Control','no-store');
    res.json({ updated: true, serverTimestamp: (serverDate || new Date()).toISOString(), ...agg });
  } catch (e) {
    console.error('Error in /stats/aggregates', e);
    res.status(500).json({ error: 'aggregates_failed', details: e.message });
  }
});

// Incremental endpoint: supply lastKnownTs; if no new base data, respond updated:false + serverTimestamp only.
// If new data, regenerate only FULL set once and respond with changed datasets.
// NOTE: This uses the in-memory cached timestamp — ZERO DB cost per request.
app.get('/stats/incremental', async (req, res) => {
  try {
    const clientTsRaw = typeof req.query.lastKnownTs === 'string' ? req.query.lastKnownTs : null;
    const parsedClientTs = clientTsRaw ? new Date(clientTsRaw) : null;
    const clientTs = parsedClientTs && !Number.isNaN(parsedClientTs.getTime()) ? parsedClientTs : null;
    const { timestamp: serverLastTs, source: timestampSource } = await getDataTimestampWithFallback();
    // If timestamp is unavailable, proceed with generation instead of hard-failing.
    // Stats queries work independently of the timestamp — the timestamp only gates
    // whether we *need* to regenerate. Without it, always regenerate (cold-start behavior).
    const serverDate = serverLastTs ? new Date(serverLastTs) : null;
    if (!serverDate) {
      console.warn('[stats/incremental] Timestamp unavailable (source:', timestampSource, ') — treating as cold start, will generate stats');
    }
    const needs = !serverDate || !clientTs || serverDate > clientTs;
    const effectiveTimestamp = serverDate || new Date();
    const sourceChanged =
      !lastGeneratedServerTimestamp || !serverDate ||
      serverDate.getTime() !== new Date(lastGeneratedServerTimestamp).getTime();
    let payload = { updated: false, serverTimestamp: effectiveTimestamp.toISOString() };
    if (needs) {
      // Regenerate when source actually changed, OR on cold start when we have no cached data
      // (e.g. after a container restart).
      if (sourceChanged || !lastGeneratedData) {
        if (!statsGenerationPromise) {
          statsGenerationPromise = runStatsUpdateScript().finally(()=>{ statsGenerationPromise=null; });
        }
        try {
          const result = await statsGenerationPromise;
          if (serverDate) lastGeneratedServerTimestamp = serverDate;
          lastGeneratedData = result.data;
          payload = { updated: true, serverTimestamp: effectiveTimestamp.toISOString(), ...result.data };
        } catch (e) {
          console.error('Incremental generation failed', e);
          return res.status(500).json({ error: 'incremental_failed', details: e.message });
        }
      } else if (lastGeneratedData) {
        payload = { updated: true, serverTimestamp: effectiveTimestamp.toISOString(), ...lastGeneratedData };
      }
    }
    res.set('Cache-Control','no-store');
    res.json(payload);
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
    // Clear cached timestamps to force regeneration of both full & aggregates
    lastGeneratedServerTimestamp = null;
    lastAggregateServerTimestamp = null;
    lastAggregateData = null;
    // Clear historical season cache so all periods are recomputed from scratch
    clearHistoricalCache();
    
    // Always run fresh generation (bypass any in-progress promise)
    cachedSeasonConfig = resolveSeasonConfig();
    cachedSeasonStart = cachedSeasonConfig.seasonStart;
    cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
    const result = await runStatsUpdateScript();
    
    // Refresh the cached timestamp immediately so next incremental check sees the new state
    await pollDataTimestamp();
    const serverLastTs = cachedLastDataTimestamp;
    if (serverLastTs) {
      lastGeneratedServerTimestamp = new Date(serverLastTs);
      lastGeneratedData = result.data;
    }
    
    // Return FULL data so frontend can write JSON files
    res.json({ 
      success: true, 
      updated: true,  // Always true for force regenerate
      message: 'Stats regenerated successfully',
      serverTimestamp: new Date().toISOString(),  // Use current time, not DB time
      // Include all datasets
      ...result.data
    });
  } catch (e) {
    console.error('Error in force regenerate', e);
    res.status(500).json({ error: 'regeneration_failed', details: e.message });
  }
});

// Lightweight diagnostics endpoint to help debug missing data
app.get('/stats/diagnostics', async (req, res) => {
  try {
    const { timestamp: effectiveDataTimestamp, source: effectiveTimestampSource } = await getDataTimestampWithFallback();
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
      cachedLastDataTimestamp: cachedLastDataTimestamp ? cachedLastDataTimestamp.toISOString() : null,
      effectiveDataTimestamp: effectiveDataTimestamp ? new Date(effectiveDataTimestamp).toISOString() : null,
      effectiveTimestampSource,
      lastTimestampPollAt: lastTimestampPollAt ? lastTimestampPollAt.toISOString() : null,
      lastTimestampPollError,
      lastTimestampSource,
      lastGeneratedServerTimestamp,
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
  app.use('/live', liveRoutes.router);
  app.use('/live/notifications/inbox', notificationInboxRoutes.router);

  // Admin check — lightweight GET, no auth middleware (only returns boolean)
  app.get('/admin/check/:uid', async (req, res) => {
    try {
      const { uid } = req.params;
      if (!uid) return res.json({ isAdmin: false });
      const r = await pool.query(
        `SELECT is_admin FROM admins WHERE uid = $1 AND is_admin = true`,
        [uid]
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
      // --- updated_at tracking ---
      `CREATE OR REPLACE FUNCTION update_timestamp() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='updated_at') THEN ALTER TABLE matches ADD COLUMN updated_at TIMESTAMP DEFAULT NOW(); END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='updated_at') THEN ALTER TABLE players ADD COLUMN updated_at TIMESTAMP DEFAULT NOW(); END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='matches_updated_at') THEN CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION update_timestamp(); END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='players_updated_at') THEN CREATE TRIGGER players_updated_at BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION update_timestamp(); END IF; END $$`,
      // Live state tables (attendance + team picker) — replaces Firebase RTDB
      `CREATE TABLE IF NOT EXISTS attendance (steam_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'no_response', emoji_status TEXT NOT NULL DEFAULT 'normal', is_kaptan BOOLEAN NOT NULL DEFAULT FALSE, kaptan_timestamp BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS team_picker (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), team_a_players JSONB NOT NULL DEFAULT '{}', team_b_players JSONB NOT NULL DEFAULT '{}', team_a_name_mode TEXT NOT NULL DEFAULT 'generic', team_b_name_mode TEXT NOT NULL DEFAULT 'generic', team_a_captain TEXT NOT NULL DEFAULT '', team_b_captain TEXT NOT NULL DEFAULT '', team_a_kabile TEXT NOT NULL DEFAULT '', team_b_kabile TEXT NOT NULL DEFAULT '', maps JSONB NOT NULL DEFAULT '{}', overrides JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `INSERT INTO team_picker (id) VALUES (1) ON CONFLICT DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS live_version (key TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0)`,
      `INSERT INTO live_version (key, version) VALUES ('attendance', 0), ('team_picker', 0), ('mvp_votes', 0), ('batak_captains', 0), ('batak_super_kupa', 0) ON CONFLICT DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS notification_inbox (id TEXT PRIMARY KEY, user_uid TEXT NOT NULL, topic TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data JSONB, read BOOLEAN NOT NULL DEFAULT FALSE, created_at BIGINT NOT NULL, event_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `CREATE INDEX IF NOT EXISTS notification_inbox_user_created_idx ON notification_inbox (user_uid, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS notification_inbox_version (user_uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // MVP voting tables — replaces Firebase RTDB mvpVotes/*
      `CREATE TABLE IF NOT EXISTS mvp_votes (date TEXT NOT NULL, voter_steam_id TEXT NOT NULL, voted_for_steam_id TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (date, voter_steam_id))`,
      `CREATE TABLE IF NOT EXISTS mvp_locks (date TEXT PRIMARY KEY, locked BOOLEAN NOT NULL DEFAULT TRUE, locked_by_uid TEXT, locked_by_name TEXT, locked_at BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // Batak AllStars tables — replaces Firebase RTDB batakAllStars/*
      `CREATE TABLE IF NOT EXISTS batak_captains (date TEXT NOT NULL, team_key TEXT NOT NULL, steam_id TEXT NOT NULL, steam_name TEXT, team_name TEXT, set_by_uid TEXT, set_by_name TEXT, set_at BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (date, team_key))`,
      `CREATE TABLE IF NOT EXISTS batak_super_kupa (slot TEXT PRIMARY KEY, player1_steam_id TEXT NOT NULL, player1_name TEXT NOT NULL, player1_league TEXT NOT NULL, player2_steam_id TEXT NOT NULL, player2_name TEXT NOT NULL, player2_league TEXT NOT NULL, winner_steam_id TEXT, score TEXT, date TEXT, set_by_uid TEXT, set_by_name TEXT, set_at BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      // Admin table — replaces Firebase RTDB admins/{uid}
      `CREATE TABLE IF NOT EXISTS admins (uid TEXT PRIMARY KEY, is_admin BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    ];
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { console.warn('[migration]', e.message); }
    }
    console.log('[migration] schema migrations applied');
  }

  // Run migrations, load config, then generate aggregates in the background.
  // Generating aggregates on startup ensures season_avg + last10 data is available
  // immediately instead of waiting for the first client request to trigger it.
  async function warmStartup() {
    try {
      await runMigrations();
      cachedSeasonConfig = resolveSeasonConfig();
      cachedSeasonStart = cachedSeasonConfig.seasonStart;
      cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
      await pollDataTimestamp();
      console.log('[startup] migrations applied, config loaded. Generating initial aggregates...');
      const agg = await generateAggregates(pool, { seasonStart: cachedSeasonStart, seasonStarts: cachedSeasonStarts });
      lastAggregateData = agg;
      const ts = cachedLastDataTimestamp;
      if (ts) lastAggregateServerTimestamp = new Date(ts);
      console.log('[startup] initial aggregates generation complete');
    } catch (e) {
      console.warn('[startup] warmStartup failed (will retry on first request)', e.message);
    }
  }
  warmStartup();
  app.listen(port, () => {
    console.log(`Middleware is running on port ${port}`);

    // Start the notification scheduler after the server is listening.
    // It uses getCachedDataTimestamp() (in-memory, no DB cost) to detect stats changes.
    notificationScheduler.start({
      getCachedDataTimestamp: () => cachedLastDataTimestamp,
      pool,
    });
  });
}
 
module.exports = app;

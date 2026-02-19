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

// Hardcoded PostgreSQL connection details

let pool = null;
const TEST_MODE = process.env.NODE_ENV === 'test';
if (!TEST_MODE) {
  pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: 5432,
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
  // Check both matches.date (for new entries) and updated_at columns (for modifications).
  // Uses GREATEST to pick the most recent change across all tracked tables.
  // NOTE: Uses subqueries instead of LEFT JOIN ON TRUE to avoid cartesian product.
  const query = `
    SELECT GREATEST(
      COALESCE((SELECT MAX(date) FROM matches), '1970-01-01'::timestamp),
      COALESCE((SELECT MAX(updated_at) FROM matches), '1970-01-01'::timestamp),
      COALESCE((SELECT MAX(updated_at) FROM players), '1970-01-01'::timestamp)
    ) AS last_change;`;
  try {
    const r = await pool.query(query);
    return r.rows[0]?.last_change || null;
  } catch (e) {
    // Fallback query if updated_at columns don't exist yet
    console.warn('Extended timestamp query failed, falling back to matches.date only:', e.message);
    try {
      const fallback = await pool.query(`SELECT COALESCE(MAX(date), '1970-01-01'::timestamp) AS last_change FROM matches;`);
      return fallback.rows[0]?.last_change || null;
    } catch (e2) {
      console.error('Error fetching last data timestamp', e2);
      return null;
    }
  }
}

// --- Cached timestamp poller ---
// The DB timestamp is polled in the background every 60s.
// All request handlers read from memory, ZERO DB cost per page load.
const DB_POLL_INTERVAL_MS = 60 * 1000; // 60 seconds
let cachedLastDataTimestamp = null; // in-memory cache of last DB data timestamp

async function pollDataTimestamp() {
  try {
    const ts = await fetchLastDataTimestampFromDB();
    if (ts) cachedLastDataTimestamp = new Date(ts);
  } catch (e) {
    console.error('[timestamp-poller] Error polling DB timestamp:', e.message);
  }
}

// Returns the cached timestamp (never hits DB)
function getCachedDataTimestamp() {
  if (TEST_MODE) return fetchLastDataTimestampFromDB(); // test mode needs async per-call
  return cachedLastDataTimestamp;
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
let lastGeneratedData = null; // cache of last generated datasets so we can resend when not updated (for volume backfill)


// Aggregates endpoint: recompute only when DB data has changed (or on cold start).
// Uses the same in-memory cached timestamp as /stats/incremental to avoid unnecessary DB work.
let lastAggregateServerTimestamp = null; // tracks DB timestamp of last aggregate generation
let lastAggregateData = null; // cached aggregate result
let aggregateGenerationPromise = null; // concurrency lock

app.get('/stats/aggregates', async (req, res) => {
  try {
    const serverLastTs = TEST_MODE ? await getCachedDataTimestamp() : getCachedDataTimestamp();
    const serverDate = serverLastTs ? new Date(serverLastTs) : null;

    // If we have cached data and the DB hasn't changed since, return cached result immediately
    if (lastAggregateData && serverDate && lastAggregateServerTimestamp &&
        serverDate.getTime() === new Date(lastAggregateServerTimestamp).getTime()) {
      res.set('Cache-Control','no-store');
      return res.json({ updated: true, serverTimestamp: serverDate.toISOString(), ...lastAggregateData });
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
    const serverLastTs = TEST_MODE ? await getCachedDataTimestamp() : getCachedDataTimestamp();
    if (!serverLastTs) return res.status(500).json({ error: 'timestamp_unavailable' });
    const serverDate = new Date(serverLastTs);
    const needs = !clientTs || serverDate > clientTs;
    const sourceChanged =
      !lastGeneratedServerTimestamp ||
      serverDate.getTime() !== new Date(lastGeneratedServerTimestamp).getTime();
    let payload = { updated: false, serverTimestamp: serverDate.toISOString() };
    if (needs) {
      // Regenerate only when source timestamp actually changed (or on cold start).
      // If unchanged, reuse cached payload to avoid repeated heavy SQL.
      if (sourceChanged || !lastGeneratedData) {
        if (!statsGenerationPromise) {
          statsGenerationPromise = runStatsUpdateScript().finally(()=>{ statsGenerationPromise=null; });
        }
        try {
          const result = await statsGenerationPromise;
          lastGeneratedServerTimestamp = serverDate;
          lastGeneratedData = result.data;
          payload = { updated: true, serverTimestamp: serverDate.toISOString(), ...result.data };
        } catch (e) {
          console.error('Incremental generation failed', e);
          return res.status(500).json({ error: 'incremental_failed', details: e.message });
        }
      } else {
        payload = { updated: true, serverTimestamp: serverDate.toISOString(), ...lastGeneratedData };
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
    res.json({ seasonStart, seasonStarts, lastGeneratedServerTimestamp, counts });
  } catch (e) {
    res.status(500).json({ error: 'diagnostics_failed', details: e.message });
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET') {
    return next();
  }

  const apiKey = req.headers['authorization'];

  // Check if the Authorization header is present and starts with 'Bearer '
  if (!apiKey || !apiKey.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // Extract the token after 'Bearer ' and compare it with the environment variable
  const token = apiKey.split(' ')[1];
  if (token !== process.env.AUTH_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
});

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
  // Warm startup generation to ensure canonical names load & early visibility.
  async function warmStartup() {
    try {
      cachedSeasonConfig = resolveSeasonConfig();
      cachedSeasonStart = cachedSeasonConfig.seasonStart;
      cachedSeasonStarts = cachedSeasonConfig.seasonStarts;
      console.log('[startup] triggering initial aggregates generation');
      await generateAggregates(pool, { seasonStart: cachedSeasonStart, seasonStarts: cachedSeasonStarts });
      console.log('[startup] initial aggregates generation complete');
    } catch (e) {
      console.warn('[startup] initial aggregates generation failed', e.message);
    }
  }
  warmStartup();
  app.listen(port, () => {
    console.log(`Middleware is running on port ${port}`);
  });
}
 
module.exports = app;

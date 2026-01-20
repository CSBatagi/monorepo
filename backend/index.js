const express = require('express');
const { Pool } = require('pg');
const { json } = require('body-parser');
const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');
const RconConnection = require('./rcon.js');
const GcpManager = require('./gcp.js');


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
async function fetchLastDataTimestamp() {
  // Using greatest of max dates across relevant tables; adjust if you add more tables influencing stats
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
  // Falls back gracefully if updated_at columns don't exist yet.
  const query = `
    SELECT GREATEST(
      COALESCE(MAX(m.date), '1970-01-01'::timestamp),
      COALESCE(MAX(m.updated_at), '1970-01-01'::timestamp),
      COALESCE(MAX(p.updated_at), '1970-01-01'::timestamp)
    ) AS last_change
    FROM matches m
    LEFT JOIN players p ON TRUE
    LIMIT 1;`;
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

// Lazy load & reuse the update-stats logic by spawning node process (decoupled from backend container codebase path)
const { generateAll, generateAggregates } = require('./statsGenerator');

// Resolve season start date: prefer file season_start.json if exists and has season_start field
function resolveSeasonStart() {
  const explicitEnvDate = process.env.SEZON_BASLANGIC; // legacy fallback option
  const explicitFile = process.env.SEASON_START_FILE;  // preferred override path
  const candidateFiles = [];
  if (explicitFile) candidateFiles.push(explicitFile);
  // Support mounting the file beside backend (e.g. - ./frontend-nextjs/public/data/season_start.json:/app/season_start.json:ro)
  candidateFiles.push(path.join(process.cwd(), 'season_start.json'));
  // Monorepo relative path (works in dev when both folders present)
  candidateFiles.push(path.join(__dirname, '..', 'frontend-nextjs', 'public', 'data', 'season_start.json'));
  for (const fp of candidateFiles) {
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.season_start) {
        return parsed.season_start.split('T')[0];
      }
    } catch (_) { /* try next */ }
  }
  return explicitEnvDate || '2025-06-09';
}
let cachedSeasonStart = resolveSeasonStart();
async function runStatsUpdateScript() {
  if (TEST_MODE) {
    return { stdout: 'test-mode skip', data: { night_avg: {} } };
  }
  // Re-resolve season start each generation in case file changed
  cachedSeasonStart = resolveSeasonStart();
  const datasets = await generateAll(pool, { seasonStart: cachedSeasonStart });
  return { stdout: 'ok', data: datasets };
}

// Concurrency lock so only one generation runs at a time
let statsGenerationPromise = null;
let lastGeneratedServerTimestamp = null; // tracks last successful generation based on server data timestamp
let lastGeneratedData = null; // cache of last generated datasets so we can resend when not updated (for volume backfill)


// Aggregates endpoint: ALWAYS recompute season_avg & last10 (lightweight compared to full set)
app.get('/stats/aggregates', async (req, res) => {
  try {
    cachedSeasonStart = resolveSeasonStart();
    const agg = await generateAggregates(pool, { seasonStart: cachedSeasonStart });
    res.set('Cache-Control','no-store');
    res.json({ updated: true, serverTimestamp: new Date().toISOString(), ...agg });
  } catch (e) {
    console.error('Error in /stats/aggregates', e);
    res.status(500).json({ error: 'aggregates_failed', details: e.message });
  }
});

// Incremental endpoint: supply lastKnownTs; if no new base data, respond updated:false + serverTimestamp only.
// If new data, regenerate only FULL set once and respond with changed datasets (same behavior as check-and-update without includeAll).
app.get('/stats/incremental', async (req, res) => {
  try {
    const clientTs = req.query.lastKnownTs ? new Date(req.query.lastKnownTs) : null;
    const serverLastTs = await fetchLastDataTimestamp();
    if (!serverLastTs) return res.status(500).json({ error: 'timestamp_unavailable' });
    const serverDate = new Date(serverLastTs);
    const needs = !clientTs || serverDate > clientTs;
    let payload = { updated: false, serverTimestamp: serverDate.toISOString() };
    if (needs) {
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
    }
    res.set('Cache-Control','no-store');
    res.json(payload);
  } catch (e) {
    console.error('Error in /stats/incremental', e);
    res.status(500).json({ error: 'internal', details: e.message });
  }
});

// Force regeneration endpoint (for admin use)
app.post('/stats/force-regenerate', async (req, res) => {
  try {
    console.log('[force-regenerate] Manual regeneration triggered');
    // Clear cached timestamp to force regeneration
    lastGeneratedServerTimestamp = null;
    // Run stats generation
    if (!statsGenerationPromise) {
      statsGenerationPromise = runStatsUpdateScript().finally(()=>{ statsGenerationPromise=null; });
    }
    const result = await statsGenerationPromise;
    const serverLastTs = await fetchLastDataTimestamp();
    if (serverLastTs) {
      lastGeneratedServerTimestamp = new Date(serverLastTs);
      lastGeneratedData = result.data;
    }
    res.json({ 
      success: true, 
      message: 'Stats regenerated successfully',
      serverTimestamp: lastGeneratedServerTimestamp,
      datasets: Object.keys(result.data || {})
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
    let counts = {};
    if (lastGeneratedData) {
      counts = {
        season_avg: Array.isArray(lastGeneratedData.season_avg)? lastGeneratedData.season_avg.length : 0,
        night_avg_dates: lastGeneratedData.night_avg ? Object.keys(lastGeneratedData.night_avg).length : 0,
        last10: Array.isArray(lastGeneratedData.last10)? lastGeneratedData.last10.length : 0,
        sonmac_dates: lastGeneratedData.sonmac_by_date ? Object.keys(lastGeneratedData.sonmac_by_date).length : 0,
        duello_son_mac_rows: lastGeneratedData.duello_son_mac ? lastGeneratedData.duello_son_mac.playerRows?.length : 0,
        duello_sezon_rows: lastGeneratedData.duello_sezon ? lastGeneratedData.duello_sezon.playerRows?.length : 0,
        performance_players: Array.isArray(lastGeneratedData.performance_data)? lastGeneratedData.performance_data.length : 0,
        errors: lastGeneratedData.__errors || []
      };
    }
    res.json({ seasonStart, lastGeneratedServerTimestamp, counts });
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

// POST endpoint to execute a query
app.post('/execute-query', async (req, res) => {
  try {
    const { query } = req.body; // Get the query from the request body

    if (!query) {
      return res.status(400).json({ error: 'Query is required in the request body.' });
    }

    try {
      const result = await pool.query(query);

      // Build the response structure
      const response = {
        columns: result.fields.map(field => field.name), // Extract column names
        rows: result.rows.map(row => Object.values(row)), // Convert row objects to arrays
      };

      res.json(response);
    } catch (err) {
      console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to execute query.', details: err.message });
    }
  } catch (err) {
    console.error('Error parsing request body:', err);
    res.status(400).json({ error: 'Failed to parse request body.', details: err.message });
  }
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
      cachedSeasonStart = resolveSeasonStart();
      console.log('[startup] triggering initial aggregates generation');
      await generateAggregates(pool, { seasonStart: cachedSeasonStart });
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

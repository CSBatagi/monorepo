'use strict';
// Demo archive listing, per-player download links and the automatic analysis queue.
//
// The game VM's analyzer worker reports which demo files exist locally; the backend decides
// which of them to analyze (finished recordings of website matches, or admin requests), the
// worker runs the CS Demo Manager CLI, and the backend verifies the result against the
// CS Demo Manager tables. Downloads are short-lived V4 signed Cloud Storage URLs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sessionUser, isSteamAdmin } = require('./steamAuth');
const { ANALYSIS_SOURCES, DEFAULT_ANALYSIS_SOURCE, DEMO_UPLOAD_MIGRATIONS, UPLOAD_PREFIX, defaultStorage, uploadSettings } = require('./demoUploads');
const { ANALYSIS_SERVER_MIGRATIONS, ServerBusy } = require('./analysisServer');

const BUCKET = process.env.DEMO_BUCKET || 'csbatagi-demos';
const BUCKET_REFRESH_MS = Number(process.env.DEMO_BUCKET_REFRESH_MS || 5 * 60 * 1000);
const DOWNLOAD_TTL_SECONDS = 15 * 60;
const STUCK_ANALYSIS_MS = 2 * 60 * 60 * 1000;
// Uploaded demos live only in the bucket; the worker fetches them with a signed link of this lifetime.
const WORKER_DOWNLOAD_TTL_SECONDS = 2 * 60 * 60;
const STORAGE_HOST = 'storage.googleapis.com';

// MatchZy names demos {TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}; the resurrection build appends 8 hex characters.
// Community "_d" map variants (de_cbble_d, de_tuscan_d) are the only underscores allowed inside the map token.
const NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(-?\d+)_(de_[a-z0-9]+(?:_d)?)_(.+?)_vs_(.+?)(?:_([0-9a-f]{8}))?\.dem$/;
const SAFE_NAME = /^[\p{L}\p{N}._-]{1,200}\.dem$/u;

function isDemoName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name) && !name.includes('..');
}

function parseDemoName(name) {
  const match = NAME_PATTERN.exec(name);
  if (!match) return { name, matchId: null, map: null, team1: null, team2: null, recordedAt: null };
  const [, day, clock, id, map, team1, team2] = match;
  const recordedAt = new Date(`${day}T${clock.replace(/-/g, ':')}Z`);
  return {
    name,
    matchId: Number(id),
    map,
    team1: team1.replace(/_/g, ' '),
    team2: team2.replace(/_/g, ' '),
    recordedAt: Number.isNaN(recordedAt.getTime()) ? null : recordedAt,
  };
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function loadServiceAccount() {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'credentials.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.client_email || !parsed.private_key) throw new Error('Service account credentials are incomplete');
  return { email: parsed.client_email, privateKey: parsed.private_key, file };
}

// Cloud Storage V4 signing (https://cloud.google.com/storage/docs/access-control/signing-urls-manually).
function signedDownloadUrl(objectName, { account, now = new Date(), expiresSeconds = DOWNLOAD_TTL_SECONDS, filename, bucket = BUCKET }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const scope = `${stamp.slice(0, 8)}/auto/storage/goog4_request`;
  const canonicalPath = `/${bucket}/` + objectName.split('/').map(encodeRfc3986).join('/');
  const params = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', `${account.email}/${scope}`],
    ['X-Goog-Date', stamp],
    ['X-Goog-Expires', String(expiresSeconds)],
    ['X-Goog-SignedHeaders', 'host'],
  ];
  if (filename) params.push(['response-content-disposition', `attachment; filename="${filename.replace(/["\\]/g, '')}"`]);
  const query = params
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonicalRequest = ['GET', canonicalPath, query, `host:${STORAGE_HOST}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['GOOG4-RSA-SHA256', stamp, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(stringToSign), account.privateKey).toString('hex');
  return {
    url: `https://${STORAGE_HOST}${canonicalPath}?${query}&X-Goog-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000),
    canonicalRequest,
    stringToSign,
  };
}

async function listBucketObjects(account) {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ keyFilename: account.file, scopes: ['https://www.googleapis.com/auth/devstorage.read_only'] });
  const client = await auth.getClient();
  const objects = [];
  let pageToken;
  do {
    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `https://${STORAGE_HOST}/storage/v1/b/${BUCKET}/o?fields=items(name,size,updated),nextPageToken&maxResults=1000${page}`;
    const response = await client.request({ url, timeout: 20000 });
    objects.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return objects
    .filter(object => object.name.endsWith('.dem'))
    .map(object => ({ objectName: object.name, name: object.name.split('/').pop(), size: Number(object.size) || 0, updated: object.updated }));
}

// Only finished recordings of matches the website created are analyzed without an admin asking.
// Recordings before the cutoff (the 10 September 2026 resurrection tests were bot matches created
// through the website) stay manual so test rosters never reach club statistics on their own.
const AUTO_ANALYZE_SINCE = new Date(process.env.DEMO_AUTO_ANALYZE_SINCE || '2026-09-11T00:00:00Z');
// Production write switch: nothing is queued automatically until DEMO_AUTO_ANALYZE=true. Admin
// requests from the website remain possible because they are explicit.
const autoAnalyzeEnabled = () => process.env.DEMO_AUTO_ANALYZE === 'true';
function autoQueueCandidates(demos, matchDir, since = AUTO_ANALYZE_SINCE) {
  return demos
    .filter(demo => demo.recordingState === 'map-ended' && demo.archiveState === 'verified' && Number.isInteger(demo.matchId) && demo.matchId > 0)
    .filter(demo => { const recorded = parseDemoName(demo.name).recordedAt; return recorded && recorded >= since; })
    .filter(demo => fs.existsSync(path.join(matchDir, `${demo.matchId}.json`)))
    .map(demo => demo.name);
}

function registerDemoRoutes(app, { pool, listObjects = null, account = null, storage = null, analysisServer = null, now = () => new Date() }) {
  const matchDir = process.env.CS2_MATCH_DIR || path.join(__dirname, 'cs2-control');
  const credentials = () => account || (account = loadServiceAccount());
  const bucket = { refreshedAt: 0, error: null, count: 0, refreshing: null };

  const bearer = (req, res, next) => {
    if (!process.env.AUTH_TOKEN || req.get('authorization') !== `Bearer ${process.env.AUTH_TOKEN}`) return res.sendStatus(403);
    next();
  };
  const member = (req, res, next) => {
    const user = sessionUser(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!user) return res.status(401).json({ error: 'Sign in to see the demos' });
    req.memberSteamId = user.steamId;
    next();
  };
  const admin = async (req, res, next) => {
    const user = sessionUser(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!user) return res.status(401).json({ error: 'Sign in first' });
    try {
      if (!await isSteamAdmin(pool, user.steamId)) return res.status(403).json({ error: 'Demo analysis requests require an admin' });
      req.memberSteamId = user.steamId;
      next();
    } catch { res.status(503).json({ error: 'Unable to check admin access' }); }
  };

  async function upsertGameServerInventory(demos) {
    for (const demo of demos) {
      const parsed = parseDemoName(demo.name);
      await pool.query(
        `INSERT INTO demo_files (name, size, match_id, map_name, team1, team2, recorded_at, recording_state, archive_state, object_name, on_game_server, game_server_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW())
         ON CONFLICT (name) DO UPDATE SET
           size = GREATEST(demo_files.size, EXCLUDED.size),
           match_id = COALESCE(demo_files.match_id, EXCLUDED.match_id),
           recording_state = EXCLUDED.recording_state,
           archive_state = CASE WHEN EXCLUDED.archive_state = 'verified' OR demo_files.archive_state = 'verified' THEN 'verified' ELSE EXCLUDED.archive_state END,
           object_name = COALESCE(EXCLUDED.object_name, demo_files.object_name),
           on_game_server = true, game_server_seen_at = NOW(), updated_at = NOW()`,
        [demo.name, demo.size, Number.isInteger(demo.matchId) ? demo.matchId : parsed.matchId, parsed.map, parsed.team1, parsed.team2, parsed.recordedAt,
          demo.recordingState, demo.archiveState, demo.objectName || null]
      );
    }
    await pool.query('UPDATE demo_files SET on_game_server = false, updated_at = NOW() WHERE on_game_server AND NOT (name = ANY($1::text[]))', [demos.map(d => d.name)]);
  }

  async function upsertBucketInventory(objects) {
    for (const object of objects) {
      const parsed = parseDemoName(object.name);
      await pool.query(
        `INSERT INTO demo_files (name, object_name, size, match_id, map_name, team1, team2, recorded_at, recording_state, archive_state, origin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unknown', 'archived', CASE WHEN $2 LIKE '${UPLOAD_PREFIX}%' THEN 'upload' ELSE 'server' END)
         ON CONFLICT (name) DO UPDATE SET
           object_name = EXCLUDED.object_name,
           size = GREATEST(demo_files.size, EXCLUDED.size),
           archive_state = CASE WHEN demo_files.archive_state = 'verified' THEN 'verified' ELSE 'archived' END,
           updated_at = NOW()`,
        [object.name, object.objectName, object.size, parsed.matchId, parsed.map, parsed.team1, parsed.team2, parsed.recordedAt]
      );
    }
  }

  // Demos analyzed from a desktop CS Demo Manager are recognised by their file stem.
  async function reconcileWithDatabase() {
    try {
      await pool.query(
        `UPDATE demo_files f SET checksum = d.checksum, analysis_state = 'analyzed', analysis_error = NULL,
           analysis_finished_at = COALESCE(f.analysis_finished_at, m.analyze_date, NOW()), updated_at = NOW()
         FROM demos d LEFT JOIN matches m ON m.checksum = d.checksum
         WHERE f.checksum IS NULL AND f.analysis_state IN ('none', 'failed') AND d.name = left(f.name, length(f.name) - 4)`
      );
    } catch (error) {
      console.warn('[demos] reconcile skipped:', error.message);
    }
  }

  async function refreshBucket(force) {
    if (bucket.refreshing) return bucket.refreshing;
    if (!force && Date.now() - bucket.refreshedAt < BUCKET_REFRESH_MS) return null;
    bucket.refreshing = (async () => {
      try {
        const objects = await (listObjects || (() => listBucketObjects(credentials())))();
        await upsertBucketInventory(objects);
        bucket.count = objects.length;
        bucket.error = null;
      } catch (error) {
        bucket.error = error.message;
        console.warn('[demos] bucket listing failed:', error.message);
      } finally {
        bucket.refreshedAt = Date.now();
        bucket.refreshing = null;
      }
    })();
    return bucket.refreshing;
  }

  const rowColumns = `f.name, f.object_name, f.size, f.match_id, f.map_name, f.team1, f.team2, f.recorded_at, f.recording_state, f.archive_state,
           f.on_game_server, f.analysis_state, f.analysis_force, f.analysis_requested_by, f.analysis_requested_at, f.analysis_started_at,
           f.analysis_finished_at, f.analysis_error, f.checksum, f.origin, f.uploaded_by, f.uploader_name, f.source_platform,
           COALESCE(f.analysis_source, '${DEFAULT_ANALYSIS_SOURCE}') AS analysis_source, f.original_name, f.server_name`;
  const rowSql = `SELECT ${rowColumns} FROM demo_files f`;
  const listingSql = `
    SELECT ${rowColumns}, m.winner_name, m.analyze_date, d.duration, team.teams
    FROM demo_files f
    LEFT JOIN matches m ON m.checksum = f.checksum
    LEFT JOIN demos d ON d.checksum = f.checksum
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('name', t.name, 'score', t.score, 'letter', t.letter) ORDER BY t.letter) AS teams
      FROM teams t WHERE t.match_checksum = f.checksum
    ) team ON true
    ORDER BY f.recorded_at DESC NULLS LAST, f.name DESC LIMIT 500`;

  // Worker inventory: upsert, auto-queue, recover stuck jobs, hand out queued work.
  app.post('/demo-analysis/sync', bearer, async (req, res) => {
    const demos = Array.isArray(req.body?.demos) ? req.body.demos.filter(d => isDemoName(d?.name)) : null;
    if (!demos) return res.status(400).json({ error: 'Inventory must be a list of demos' });
    analysisServer?.noteWorker(req.body);
    try {
      await upsertGameServerInventory(demos.map(d => ({
        name: d.name, size: Number(d.size) || 0, matchId: Number.isInteger(d.matchId) ? d.matchId : null,
        recordingState: typeof d.recordingState === 'string' ? d.recordingState.slice(0, 40) : 'unknown',
        archiveState: d.archiveState === 'verified' ? 'verified' : 'pending', objectName: typeof d.objectName === 'string' ? d.objectName : null,
      })));
      await reconcileWithDatabase();
      const candidates = autoAnalyzeEnabled()
        ? autoQueueCandidates(demos.map(d => ({ ...d, matchId: Number.isInteger(d.matchId) ? d.matchId : parseDemoName(d.name).matchId })), matchDir)
        : [];
      if (candidates.length) {
        await pool.query(
          `UPDATE demo_files SET analysis_state = 'queued', analysis_force = false, analysis_requested_by = 'auto', analysis_requested_at = NOW(), analysis_error = NULL, updated_at = NOW()
           WHERE name = ANY($1::text[]) AND analysis_state = 'none' AND checksum IS NULL`, [candidates]);
      }
      await pool.query(
        `UPDATE demo_files SET analysis_state = 'queued', analysis_error = 'Previous attempt did not finish', updated_at = NOW()
         WHERE analysis_state = 'analyzing' AND analysis_started_at < NOW() - ($1 || ' milliseconds')::interval`, [String(STUCK_ANALYSIS_MS)]);
      const jobs = req.body.busy ? { rows: [] } : await pool.query(
        `SELECT name, object_name AS "objectName", analysis_force AS force, on_game_server AS "onGameServer",
                analysis_source AS source, origin, recorded_at AS "recordedAt", size
         FROM demo_files WHERE analysis_state = 'queued' ORDER BY analysis_requested_at ASC NULLS LAST, name ASC LIMIT 5`);
      res.json({ jobs: jobs.rows.map(workerJob) });
    } catch (error) {
      console.error('[demos] sync failed:', error.message);
      res.status(500).json({ error: 'Inventory sync failed' });
    }
  });

  // Uploaded demos carry a signed link (the game VM's own account reads only its recordings) and the
  // match time, which the worker writes as the file's mtime: CS Demo Manager dates a match by mtime.
  function workerJob(row) {
    const job = {
      name: row.name, objectName: row.objectName, force: row.force, onGameServer: row.onGameServer,
      source: ANALYSIS_SOURCES.includes(row.source) ? row.source : DEFAULT_ANALYSIS_SOURCE,
    };
    if (row.origin !== 'upload') return job;
    if (row.recordedAt) job.recordedAt = new Date(row.recordedAt).toISOString();
    if (row.size) job.size = Number(row.size);
    if (row.objectName) {
      try {
        job.downloadUrl = signedDownloadUrl(row.objectName, { account: credentials(), now: now(), expiresSeconds: WORKER_DOWNLOAD_TTL_SECONDS }).url;
      } catch (error) {
        console.warn('[demos] worker link failed:', error.message);
      }
    }
    return job;
  }

  app.post('/demo-analysis/result', bearer, async (req, res) => {
    const { name, state } = req.body || {};
    const detail = typeof req.body?.error === 'string' ? req.body.error.slice(0, 1000) : null;
    if (!isDemoName(name) || !['analyzing', 'analyzed', 'failed'].includes(state)) return res.status(400).json({ error: 'Invalid analysis report' });
    try {
      if (state === 'analyzing') {
        await pool.query(`UPDATE demo_files SET analysis_state = 'analyzing', analysis_started_at = NOW(), analysis_error = NULL, updated_at = NOW() WHERE name = $1`, [name]);
      } else if (state === 'failed') {
        await pool.query(`UPDATE demo_files SET analysis_state = 'failed', analysis_finished_at = NOW(), analysis_error = $2, updated_at = NOW() WHERE name = $1`, [name, detail || 'Analysis failed']);
      } else {
        // The worker's exit code is not proof; the demo must actually be in the CS Demo Manager tables.
        const found = await pool.query('SELECT checksum FROM demos WHERE name = $1', [name.slice(0, -4)]);
        if (found.rows.length) {
          await pool.query(`UPDATE demo_files SET analysis_state = 'analyzed', analysis_force = false, checksum = $2, analysis_finished_at = NOW(), analysis_error = NULL, updated_at = NOW() WHERE name = $1`, [name, found.rows[0].checksum]);
        } else {
          await pool.query(`UPDATE demo_files SET analysis_state = 'failed', analysis_finished_at = NOW(), analysis_error = $2, updated_at = NOW() WHERE name = $1`, [name, 'Analysis finished but the demo is not in the database']);
        }
      }
      const row = await pool.query(`${rowSql} WHERE f.name = $1`, [name]);
      res.json(row.rows[0] || { name, analysis_state: state });
    } catch (error) {
      console.error('[demos] result failed:', error.message);
      res.status(500).json({ error: 'Analysis report failed' });
    }
  });

  app.get('/demos', bearer, member, async (req, res) => {
    try {
      await refreshBucket(req.query.refresh === '1');
      await reconcileWithDatabase();
      let rows;
      try {
        rows = (await pool.query(listingSql)).rows;
      } catch (error) {
        // Without the CS Demo Manager tables (fresh database) fall back to the archive columns only.
        console.warn('[demos] listing without match details:', error.message);
        rows = (await pool.query(`${rowSql} ORDER BY f.recorded_at DESC NULLS LAST, f.name DESC LIMIT 500`)).rows;
      }
      const server = analysisServer ? await analysisServer.snapshot().catch(() => null) : null;
      res.set('Cache-Control', 'no-store').json({
        demos: rows,
        autoAnalyze: autoAnalyzeEnabled(),
        uploads: (({ enabled, chunkBytes, minBytes, maxBytes, dailyLimit }) => ({ enabled, chunkBytes, minBytes, maxBytes, dailyLimit }))(uploadSettings()),
        analysisServer: server,
        bucket: { refreshedAt: bucket.refreshedAt ? new Date(bucket.refreshedAt).toISOString() : null, error: bucket.error, count: bucket.count },
      });
    } catch (error) {
      console.error('[demos] listing failed:', error.message);
      res.status(500).json({ error: 'Demo listing failed' });
    }
  });

  app.get('/demos/:name/download', bearer, member, async (req, res) => {
    const { name } = req.params;
    if (!isDemoName(name)) return res.status(400).json({ error: 'Invalid demo name' });
    try {
      const row = await pool.query('SELECT object_name FROM demo_files WHERE name = $1', [name]);
      if (!row.rows.length || !row.rows[0].object_name) return res.status(404).json({ error: 'This demo is not in the archive yet' });
      const signed = signedDownloadUrl(row.rows[0].object_name, { account: credentials(), now: now(), filename: name });
      res.set('Cache-Control', 'no-store').json({ url: signed.url, expiresAt: signed.expiresAt.toISOString() });
    } catch (error) {
      console.error('[demos] download link failed:', error.message);
      res.status(500).json({ error: 'Could not create a download link' });
    }
  });

  app.post('/demos/:name/analyze', bearer, admin, async (req, res) => {
    const { name } = req.params;
    if (!isDemoName(name)) return res.status(400).json({ error: 'Invalid demo name' });
    // Optional `csdm analyze --source` override, e.g. "matchzy" for xplay.gg demos without a known source.
    const source = req.body?.source ?? null;
    if (source !== null && !ANALYSIS_SOURCES.includes(source)) return res.status(400).json({ error: 'Unknown analysis source' });
    try {
      const current = await pool.query('SELECT analysis_state, checksum, on_game_server, object_name FROM demo_files WHERE name = $1', [name]);
      const row = current.rows[0];
      if (!row) return res.status(404).json({ error: 'Unknown demo' });
      if (['queued', 'analyzing'].includes(row.analysis_state)) return res.status(409).json({ error: 'This demo is already waiting for analysis' });
      if (!row.on_game_server && !row.object_name) return res.status(409).json({ error: 'This demo is neither on the game server nor in the archive' });
      const force = Boolean(row.checksum) || row.analysis_state === 'analyzed';
      const updated = await pool.query(
        `UPDATE demo_files SET analysis_state = 'queued', analysis_force = $2, analysis_requested_by = $3, analysis_requested_at = NOW(), analysis_error = NULL,
           analysis_source = COALESCE($4, analysis_source), updated_at = NOW()
         WHERE name = $1 RETURNING name, analysis_state, analysis_force, analysis_requested_by, analysis_requested_at, analysis_source`, [name, force, req.memberSteamId, source]);
      // The analyzer runs on the game VM: start it if it is off (it closes itself once idle).
      let server = null;
      if (analysisServer) {
        try { server = await analysisServer.ensureRunning(req.memberSteamId); }
        catch (error) { console.warn('[demos] could not start the game VM:', error.message); server = { vm: 'unknown', error: 'Game server state unavailable' }; }
      }
      res.json({ message: force ? 'Re-analysis queued' : 'Analysis queued', demo: updated.rows[0], server });
    } catch (error) {
      console.error('[demos] analyze request failed:', error.message);
      res.status(500).json({ error: 'Could not queue the analysis' });
    }
  });

  // Admin controls for the game VM as the analysis machine (see analysisServer.js).
  app.post('/analysis-server/:action', bearer, admin, async (req, res) => {
    if (!analysisServer) return res.status(503).json({ error: 'Analysis server control is not configured' });
    try {
      if (req.params.action === 'start') return res.json(await analysisServer.ensureRunning(req.memberSteamId));
      if (req.params.action === 'stop') return res.json(await analysisServer.stopNow(req.memberSteamId));
      res.status(404).json({ error: 'Unknown action' });
    } catch (error) {
      if (error instanceof ServerBusy) return res.status(409).json({ error: error.message, reason: error.reason });
      console.error('[demos] analysis server control failed:', error.message);
      res.status(502).json({ error: 'Oyun sunucusuna ulaşılamadı; biraz sonra tekrar deneyin.' });
    }
  });

  // Only member uploads can be removed; the server's own recordings are never deleted from here.
  // Statistics already written by an analysis stay in the database until removed in CS Demo Manager.
  app.delete('/demos/:name', bearer, admin, async (req, res) => {
    const { name } = req.params;
    if (!isDemoName(name)) return res.status(400).json({ error: 'Invalid demo name' });
    try {
      const row = (await pool.query('SELECT origin, object_name, analysis_state FROM demo_files WHERE name = $1', [name])).rows[0];
      if (!row) return res.status(404).json({ error: 'Unknown demo' });
      if (row.origin !== 'upload' || !row.object_name?.startsWith(UPLOAD_PREFIX)) return res.status(403).json({ error: 'Only uploaded demos can be deleted' });
      if (['queued', 'analyzing'].includes(row.analysis_state)) return res.status(409).json({ error: 'This demo is waiting for analysis' });
      try {
        await (storage || defaultStorage()).deleteObject(row.object_name);
      } catch (error) {
        console.error('[demos] upload delete failed:', error.message);
        return res.status(503).json({ error: error.status === 403 ? 'The backend is not allowed to delete uploads' : 'Could not delete the file from storage' });
      }
      await pool.query('DELETE FROM demo_files WHERE name = $1', [name]);
      await pool.query(`UPDATE demo_uploads SET state = 'deleted', updated_at = NOW() WHERE demo_name = $1`, [name]);
      console.log(`[demos] ${name} deleted by ${req.memberSteamId}`);
      res.json({ deleted: name });
    } catch (error) {
      console.error('[demos] delete failed:', error.message);
      res.status(500).json({ error: 'Could not delete the demo' });
    }
  });
}

const DEMO_FILES_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS demo_files (
     name TEXT PRIMARY KEY,
     object_name TEXT,
     size BIGINT NOT NULL DEFAULT 0,
     match_id BIGINT,
     map_name TEXT,
     team1 TEXT,
     team2 TEXT,
     recorded_at TIMESTAMPTZ,
     recording_state TEXT,
     archive_state TEXT NOT NULL DEFAULT 'unknown',
     on_game_server BOOLEAN NOT NULL DEFAULT false,
     game_server_seen_at TIMESTAMPTZ,
     analysis_state TEXT NOT NULL DEFAULT 'none',
     analysis_force BOOLEAN NOT NULL DEFAULT false,
     analysis_requested_by TEXT,
     analysis_requested_at TIMESTAMPTZ,
     analysis_started_at TIMESTAMPTZ,
     analysis_finished_at TIMESTAMPTZ,
     analysis_error TEXT,
     checksum TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS demo_files_analysis_state_idx ON demo_files (analysis_state)`,
  // Member uploads from other servers (see demoUploads.js).
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'server'`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS uploaded_by TEXT`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS uploader_name TEXT`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS source_platform TEXT`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS analysis_source TEXT`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS fingerprint TEXT`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS original_name TEXT`,
  `ALTER TABLE demo_files ADD COLUMN IF NOT EXISTS server_name TEXT`,
  `CREATE INDEX IF NOT EXISTS demo_files_fingerprint_idx ON demo_files (fingerprint) WHERE fingerprint IS NOT NULL`,
  ...DEMO_UPLOAD_MIGRATIONS,
  ...ANALYSIS_SERVER_MIGRATIONS,
];

module.exports = { registerDemoRoutes, parseDemoName, isDemoName, signedDownloadUrl, autoQueueCandidates, encodeRfc3986, DEMO_FILES_MIGRATIONS };

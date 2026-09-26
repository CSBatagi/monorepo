'use strict';
// Member uploads of demos recorded on other servers (xplay.gg, FACEIT, ...).
//
// The browser sends the file in 4 MiB chunks through the website: Next.js buffers request bodies in
// its middleware, so a whole demo can never pass through one request on a 256 MB container. Every
// chunk is validated by demoFile.js before it is relayed to a Cloud Storage resumable upload session
// that only the backend knows. A rejected or abandoned file cancels its session, so its bytes never
// become an object. Finished uploads join demo_files next to the server's own demos and wait for an
// admin to queue their analysis; nothing reaches the club statistics without that step.
const crypto = require('crypto');
const path = require('path');
const { sessionUser, rosterMember } = require('./steamAuth');
const { DemoRejected, inspectDemoStart, initialScanState, scanChunk, displayMapName } = require('./demoFile');

const BUCKET = process.env.DEMO_BUCKET || 'csbatagi-demos';
const UPLOAD_PREFIX = 'uploads/';
const CHUNK_BYTES = 4 * 1024 * 1024; // resumable uploads need non-final chunks in multiples of 256 KiB
const MIN_BYTES = 1024 * 1024;
const MAX_PARALLEL_CHUNKS = 2; // bounds the chunk buffers held by the 256 MB backend container
const STALE_UPLOAD = '2 hours';
const PLATFORMS = ['xplay', 'faceit', 'other'];
// `csdm analyze --source` values accepted by CS Demo Manager 3.20.1 (@akiver/cs-demo-analyzer 1.10.5),
// plus "auto" to let the CLI detect the source itself. xplay.gg demos often carry nothing the CLI
// recognises and only analyze as "matchzy", which is why it is the default.
const ANALYSIS_SOURCES = ['matchzy', 'auto', 'valve', 'faceit', 'esea', 'esl', 'ebot', 'esplay', 'esportal', 'esportligaen',
  'fastcup', '5eplay', 'gamersclub', 'challengermode', 'perfectworld', 'popflash', 'pracc', 'renown'];
const DEFAULT_ANALYSIS_SOURCE = 'matchzy';
const CS2_RELEASE = Date.parse('2023-09-27T00:00:00Z');
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const positiveSetting = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function uploadSettings() {
  return {
    enabled: process.env.DEMO_UPLOADS_ENABLED !== 'false',
    chunkBytes: CHUNK_BYTES,
    minBytes: MIN_BYTES,
    maxBytes: positiveSetting('DEMO_UPLOAD_MAX_BYTES', 1024 * 1024 * 1024),
    dailyLimit: positiveSetting('DEMO_UPLOAD_DAILY_LIMIT', 10),
    maxActive: positiveSetting('DEMO_UPLOAD_MAX_ACTIVE', 3),
  };
}

class StorageError extends Error {
  constructor(status, detail) {
    super(`Cloud Storage responded ${status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
    this.status = status;
  }
}

function serviceAccountToken() {
  let client = null;
  return async () => {
    if (!client) {
      const { GoogleAuth } = require('google-auth-library');
      const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'credentials.json');
      client = await new GoogleAuth({ keyFilename, scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] }).getClient();
    }
    const { token } = await client.getAccessToken();
    if (!token) throw new StorageError(503, 'no access token');
    return token;
  };
}

// Cloud Storage JSON API resumable uploads (https://cloud.google.com/storage/docs/performing-resumable-uploads).
// The session URI is a write credential for one object; it never leaves the backend.
function gcsStorage({ bucket = BUCKET, apiBase = 'https://storage.googleapis.com', accessToken = serviceAccountToken(), fetchImpl = (...args) => fetch(...args) } = {}) {
  const uploadBase = `${apiBase}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const session = uri => {
    if (typeof uri !== 'string' || !uri.startsWith(`${uploadBase}?`)) throw new StorageError(502, 'unexpected upload session URL');
    return uri;
  };
  async function progress(response, total) {
    if (response.status === 308) {
      const range = /^bytes=0-(\d+)$/.exec(response.headers.get('range') || '');
      return { done: false, persisted: range ? Number(range[1]) + 1 : 0 };
    }
    if (response.status === 200 || response.status === 201) {
      const object = await response.json();
      if (Number(object.size) !== total) throw new StorageError(502, `stored ${object.size} of ${total} bytes`);
      return { done: true, persisted: total, object };
    }
    throw new StorageError(response.status, await response.text().catch(() => ''));
  }
  return {
    async startUpload({ objectName, size, metadata }) {
      const url = `${uploadBase}?uploadType=resumable&ifGenerationMatch=0&name=${encodeURIComponent(objectName)}`;
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({ name: objectName, contentType: 'application/octet-stream', contentDisposition: 'attachment', metadata }),
      });
      if (response.status !== 200 && response.status !== 201) throw new StorageError(response.status, await response.text().catch(() => ''));
      return session(response.headers.get('location'));
    },
    async putChunk(sessionUri, buffer, start, total) {
      const response = await fetchImpl(session(sessionUri), {
        method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Range': `bytes ${start}-${start + buffer.length - 1}/${total}` }, body: buffer,
      });
      return progress(response, total);
    },
    async queryUpload(sessionUri, total) {
      const response = await fetchImpl(session(sessionUri), {
        method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Range': `bytes */${total}` }, body: Buffer.alloc(0),
      });
      return progress(response, total);
    },
    async cancelUpload(sessionUri) {
      // Cloud Storage answers 499 once the session is gone; nothing to do on failure either way.
      await fetchImpl(session(sessionUri), { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(10000) }).catch(() => {});
    },
    async deleteObject(objectName) {
      const response = await fetchImpl(`${apiBase}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`, {
        method: 'DELETE', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${await accessToken()}` },
      });
      if (!response.ok && response.status !== 404) throw new StorageError(response.status, await response.text().catch(() => ''));
    },
  };
}

let sharedStorage = null;
const defaultStorage = () => sharedStorage || (sharedStorage = gcsStorage());

// Relays one validated chunk starting from where the session actually is. Cloud Storage may keep only
// part of a chunk, and a response can be lost after the bytes landed (the browser then retries the same
// offset), so the stored length is asked first and only the missing tail is sent, never overlapping bytes.
async function forwardChunk(storage, sessionUri, buffer, start, total) {
  const end = start + buffer.length;
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await storage.queryUpload(sessionUri, total);
    if (stored.done || stored.persisted >= end) return stored;
    if (stored.persisted < start) throw new StorageError(409, `storage holds ${stored.persisted} bytes, chunk starts at ${start}`);
    try {
      const result = await storage.putChunk(sessionUri, buffer.subarray(stored.persisted - start), stored.persisted, total);
      if (result.done || result.persisted >= end) return result;
    } catch (error) {
      if (error instanceof StorageError && error.status < 500) throw error;
    }
  }
  throw new StorageError(502, `chunk ending at ${end} was not stored`);
}

function cleanFileName(value) {
  if (typeof value !== 'string') return null;
  return value.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || null;
}

// Server-chosen names keep user input out of object paths. They start with the platform so the CLI's
// file-name source detection (MatchZy, eBot, 5EPlay patterns) never misfires when "auto" is chosen.
function uploadName(platform, recordedAt, id) {
  const stamp = recordedAt.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  return `${platform}_${stamp}_${id.slice(0, 8)}.dem`;
}

function demoFingerprint(size, firstChunk) {
  return crypto.createHash('sha256').update(`${size}:`).update(firstChunk).digest('hex');
}

function formatBytes(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

// Reads exactly `expected` bytes; a body of any other length is refused before it is buffered.
function readChunk(req, expected) {
  return new Promise((resolve, reject) => {
    if (Number(req.get('content-length')) !== expected) {
      req.resume();
      return reject(Object.assign(new Error(`Parça ${expected} bayt olmalı.`), { status: 400 }));
    }
    const parts = [];
    let length = 0;
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    req.on('data', part => {
      length += part.length;
      if (length > expected) { fail(Object.assign(new Error('Parça çok büyük.'), { status: 413 })); req.destroy(); return; }
      parts.push(part);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (length !== expected) return reject(Object.assign(new Error('Parça eksik geldi.'), { status: 400 }));
      resolve(Buffer.concat(parts, length));
    });
    req.on('error', fail);
    req.on('close', () => fail(Object.assign(new Error('Bağlantı koptu.'), { status: 400 })));
  });
}

function registerDemoUploadRoutes(app, { pool, storage = null, lookupRoster = rosterMember }) {
  const store = () => storage || defaultStorage();
  const inFlight = new Set();

  const bearer = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!process.env.AUTH_TOKEN || req.get('authorization') !== `Bearer ${process.env.AUTH_TOKEN}`) return res.sendStatus(403);
    next();
  };
  const member = (req, res, next) => {
    const user = sessionUser(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!user) return res.status(401).json({ error: 'Demo yüklemek için giriş yapın.' });
    req.memberSteamId = user.steamId;
    next();
  };

  // `where` is always a literal from this file; values travel as parameters.
  async function closeUploads(state, where, params) {
    const closed = await pool.query(
      `UPDATE demo_uploads SET state = $${params.length + 1}, session_uri = NULL, updated_at = NOW() WHERE state = 'uploading' AND ${where} RETURNING session_uri`,
      [...params, state]);
    await Promise.all(closed.rows.filter(row => row.session_uri).map(row => store().cancelUpload(row.session_uri)));
    return closed.rows.length;
  }
  const expireStaleUploads = () => closeUploads('expired', `updated_at < NOW() - INTERVAL '${STALE_UPLOAD}'`, []);

  async function rejectUpload(upload, error) {
    await pool.query(`UPDATE demo_uploads SET state = 'rejected', error = $2, session_uri = NULL, updated_at = NOW() WHERE id = $1`, [upload.id, error.message]);
    if (upload.session_uri) await store().cancelUpload(upload.session_uri);
    console.warn(`[demo-upload] rejected ${upload.demo_name} from ${upload.steam_id}: ${error.code}`);
  }

  async function finishUpload(upload, header, scan, fingerprint) {
    const uploader = await pool.query('SELECT display_name FROM steam_members WHERE steam_id = $1', [upload.steam_id]).catch(() => ({ rows: [] }));
    const demo = await pool.query(
      `INSERT INTO demo_files (name, object_name, size, map_name, recorded_at, recording_state, archive_state, origin, uploaded_by, uploader_name,
         source_platform, analysis_source, fingerprint, original_name, server_name)
       VALUES ($1, $2, $3, $4, $5, $6, 'verified', 'upload', $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (name) DO UPDATE SET object_name = EXCLUDED.object_name, size = EXCLUDED.size, map_name = EXCLUDED.map_name,
         recorded_at = EXCLUDED.recorded_at, recording_state = EXCLUDED.recording_state, archive_state = 'verified', origin = 'upload',
         uploaded_by = EXCLUDED.uploaded_by, uploader_name = EXCLUDED.uploader_name, source_platform = EXCLUDED.source_platform,
         analysis_source = EXCLUDED.analysis_source, fingerprint = EXCLUDED.fingerprint, original_name = EXCLUDED.original_name,
         server_name = EXCLUDED.server_name, updated_at = NOW()
       RETURNING name, map_name, recorded_at, recording_state, analysis_state`,
      [upload.demo_name, upload.object_name, upload.size, displayMapName(header?.mapName), upload.recorded_at, scan.truncated ? 'truncated' : 'uploaded',
        upload.steam_id, uploader.rows[0]?.display_name || null, upload.platform, upload.analysis_source, fingerprint, upload.original_name,
        header?.serverName ? header.serverName.slice(0, 200) : null]);
    await pool.query(
      `UPDATE demo_uploads SET state = 'complete', received = size, scan = $2, session_uri = NULL, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [upload.id, scan]);
    console.log(`[demo-upload] ${upload.demo_name} (${upload.size} bytes) uploaded by ${upload.steam_id}`);
    return demo.rows[0];
  }

  app.post('/demo-uploads', bearer, member, async (req, res) => {
    const settings = uploadSettings();
    if (!settings.enabled) return res.status(503).json({ error: 'Demo yükleme şu anda kapalı.' });
    const { size, platform = 'xplay', source = DEFAULT_ANALYSIS_SOURCE } = req.body || {};
    const fileName = cleanFileName(req.body?.fileName);
    const recordedAt = new Date(typeof req.body?.recordedAt === 'string' ? req.body.recordedAt : NaN);
    if (!fileName || !/\.dem$/i.test(fileName)) return res.status(415).json({ error: 'Yalnızca .dem uzantılı CS2 demo dosyaları yüklenebilir.', code: 'extension' });
    if (!Number.isSafeInteger(size) || size < settings.minBytes) return res.status(400).json({ error: 'Dosya bir maç demosu için çok küçük.', code: 'too_small' });
    if (size > settings.maxBytes) return res.status(413).json({ error: `Dosya çok büyük (en fazla ${formatBytes(settings.maxBytes)}).`, code: 'too_large' });
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Geçersiz platform.' });
    if (!ANALYSIS_SOURCES.includes(source)) return res.status(400).json({ error: 'Geçersiz analiz türü.' });
    const time = recordedAt.getTime();
    if (Number.isNaN(time) || time < CS2_RELEASE || time > Date.now() + 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'Maç tarihi geçersiz.' });
    const steamId = req.memberSteamId;
    try {
      if (!lookupRoster(steamId)) return res.status(403).json({ error: 'Yalnızca kulüp üyeleri demo yükleyebilir.' });
    } catch {
      return res.status(503).json({ error: 'Üyelik doğrulanamadı.' });
    }
    try {
      await expireStaleUploads();
      const existing = await pool.query('SELECT name FROM demo_files WHERE (name = $1 OR original_name = $1) AND size = $2 LIMIT 1', [fileName, size]);
      if (existing.rows.length) return res.status(409).json({ error: `Bu demo zaten arşivde: ${existing.rows[0].name}`, code: 'duplicate' });
      const usage = (await pool.query(
        `SELECT COUNT(*) FILTER (WHERE steam_id = $1 AND created_at > NOW() - INTERVAL '24 hours' AND state = 'complete')::int AS today,
                COUNT(*) FILTER (WHERE steam_id = $1 AND created_at > NOW() - INTERVAL '24 hours')::int AS attempts,
                COUNT(*) FILTER (WHERE state = 'uploading' AND steam_id <> $1)::int AS active
         FROM demo_uploads`, [steamId])).rows[0] || { today: 0, attempts: 0, active: 0 };
      // Rejected and cancelled attempts count too, at three times the limit, so retries stay possible but not endless.
      if (usage.today >= settings.dailyLimit || usage.attempts >= settings.dailyLimit * 3) {
        return res.status(429).json({ error: `Günlük yükleme sınırına ulaştınız (${settings.dailyLimit}).`, code: 'daily_limit' });
      }
      if (usage.active >= settings.maxActive) return res.status(429).json({ error: 'Şu anda çok fazla yükleme sürüyor; birkaç dakika sonra tekrar deneyin.', code: 'busy' });
      // Only now does a new upload replace the member's unfinished one (a reloaded page cannot resume it).
      await closeUploads('cancelled', 'steam_id = $1', [steamId]);

      const id = crypto.randomUUID();
      const name = uploadName(platform, recordedAt, id);
      const objectName = UPLOAD_PREFIX + name;
      let sessionUri;
      try {
        sessionUri = await store().startUpload({ objectName, size, metadata: { uploadedBy: steamId, platform } });
      } catch (error) {
        console.error('[demo-upload] storage session failed:', error.message);
        return res.status(503).json({ error: error.status === 403 ? 'Depolamaya yazma izni yok; bir yöneticiye bildirin.' : 'Depolama şu anda yanıt vermiyor.' });
      }
      await pool.query(
        `INSERT INTO demo_uploads (id, steam_id, demo_name, object_name, original_name, size, session_uri, platform, analysis_source, recorded_at, scan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, steamId, name, objectName, fileName, size, sessionUri, platform, source, recordedAt, initialScanState()]);
      res.status(201).json({ id, name, size, received: 0, chunkSize: CHUNK_BYTES });
    } catch (error) {
      console.error('[demo-upload] start failed:', error.message);
      res.status(500).json({ error: 'Yükleme başlatılamadı.' });
    }
  });

  app.put('/demo-uploads/:id', bearer, member, async (req, res) => {
    const { id } = req.params;
    const offset = Number(req.query.offset);
    if (!UPLOAD_ID.test(id) || !Number.isSafeInteger(offset) || offset < 0) { req.resume(); return res.status(400).json({ error: 'Geçersiz yükleme isteği.' }); }
    if (inFlight.has(id) || inFlight.size >= MAX_PARALLEL_CHUNKS) {
      req.resume();
      return res.status(503).set('Retry-After', '2').json({ error: 'Sunucu meşgul, parça yeniden denenecek.', retry: true });
    }
    inFlight.add(id);
    try {
      const upload = (await pool.query('SELECT * FROM demo_uploads WHERE id = $1', [id])).rows[0];
      if (!upload || upload.steam_id !== req.memberSteamId) { req.resume(); return res.status(404).json({ error: 'Yükleme bulunamadı.' }); }
      if (upload.state !== 'uploading') {
        req.resume();
        return res.status(410).json({ error: upload.state === 'rejected' ? upload.error : 'Bu yükleme artık etkin değil; yeniden başlatın.', state: upload.state });
      }
      const size = Number(upload.size);
      const received = Number(upload.received);
      if (offset !== received) { req.resume(); return res.status(409).json({ error: 'Parça sırası uyuşmadı.', received }); }
      let body;
      try {
        body = await readChunk(req, Math.min(CHUNK_BYTES, size - received));
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message, received });
      }

      let { header, fingerprint } = upload;
      let scan = upload.scan || initialScanState();
      try {
        if (offset === 0) {
          header = inspectDemoStart(body).header;
          fingerprint = demoFingerprint(size, body);
          const duplicate = await pool.query(
            `SELECT name FROM demo_files WHERE fingerprint = $1
             UNION ALL SELECT demo_name FROM demo_uploads WHERE fingerprint = $1 AND state = 'uploading' AND id <> $2 LIMIT 1`, [fingerprint, id]);
          if (duplicate.rows.length) throw new DemoRejected('duplicate', `Bu demo zaten yüklenmiş: ${duplicate.rows[0].name}`);
          scan = initialScanState();
        }
        scan = scanChunk(scan, body, offset, size);
      } catch (error) {
        if (!(error instanceof DemoRejected)) throw error;
        await rejectUpload(upload, error);
        return res.status(422).json({ error: error.message, code: error.code });
      }

      let stored;
      try {
        stored = await forwardChunk(store(), upload.session_uri, body, offset, size);
      } catch (error) {
        console.error('[demo-upload] relay failed:', error.message);
        if (error instanceof StorageError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
          await rejectUpload(upload, Object.assign(new Error('Depolama yüklemeyi kabul etmedi; yeniden başlatın.'), { code: 'storage' }));
          return res.status(410).json({ error: 'Depolama yüklemeyi kabul etmedi; yeniden başlatın.', state: 'rejected' });
        }
        return res.status(502).json({ error: 'Parça depolamaya aktarılamadı, yeniden denenecek.', received, retry: true });
      }

      if (stored.done) {
        const demo = await finishUpload(upload, header, scan, fingerprint);
        return res.json({ received: size, done: true, demo });
      }
      const next = offset + body.length;
      await pool.query(
        `UPDATE demo_uploads SET received = $2, scan = $3, header = $4, fingerprint = $5, updated_at = NOW() WHERE id = $1 AND received = $6 AND state = 'uploading'`,
        [id, next, scan, header, fingerprint, offset]);
      res.json({ received: next, done: false });
    } catch (error) {
      console.error('[demo-upload] chunk failed:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Parça işlenemedi.', retry: true });
    } finally {
      inFlight.delete(id);
    }
  });

  app.delete('/demo-uploads/:id', bearer, member, async (req, res) => {
    const { id } = req.params;
    if (!UPLOAD_ID.test(id)) return res.status(400).json({ error: 'Geçersiz yükleme.' });
    try {
      const cancelled = await closeUploads('cancelled', 'id = $1 AND steam_id = $2', [id, req.memberSteamId]);
      res.json({ cancelled: cancelled > 0 });
    } catch (error) {
      console.error('[demo-upload] cancel failed:', error.message);
      res.status(500).json({ error: 'Yükleme iptal edilemedi.' });
    }
  });
}

const DEMO_UPLOAD_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS demo_uploads (
     id TEXT PRIMARY KEY,
     steam_id TEXT NOT NULL,
     demo_name TEXT NOT NULL UNIQUE,
     object_name TEXT NOT NULL,
     original_name TEXT,
     size BIGINT NOT NULL,
     received BIGINT NOT NULL DEFAULT 0,
     session_uri TEXT,
     state TEXT NOT NULL DEFAULT 'uploading',
     platform TEXT NOT NULL,
     analysis_source TEXT NOT NULL,
     recorded_at TIMESTAMPTZ NOT NULL,
     scan JSONB NOT NULL DEFAULT '{}',
     header JSONB,
     fingerprint TEXT,
     error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     completed_at TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS demo_uploads_member_idx ON demo_uploads (steam_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS demo_uploads_state_idx ON demo_uploads (state)`,
];

module.exports = {
  registerDemoUploadRoutes, gcsStorage, defaultStorage, forwardChunk, uploadSettings, uploadName, cleanFileName, StorageError,
  ANALYSIS_SOURCES, DEFAULT_ANALYSIS_SOURCE, PLATFORMS, UPLOAD_PREFIX, DEMO_UPLOAD_MIGRATIONS,
};

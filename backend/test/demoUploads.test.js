const crypto = require('crypto');
const express = require('express');
const http = require('http');
const request = require('supertest');
const { registerDemoUploadRoutes, gcsStorage, forwardChunk, StorageError, cleanFileName } = require('../demoUploads');
const { registerDemoRoutes } = require('../demoRoutes');
const { syntheticDemo } = require('./helpers/syntheticDemo');

const secret = 'test-only-upload-key';
const MEMBER = '76561198000000001';
const OTHER = '76561198000000002';
const OUTSIDER = '76561198000000003';
const CHUNK = 4 * 1024 * 1024;

function session(steamId = MEMBER) {
  const h = Buffer.from('{}').toString('base64url');
  const b = Buffer.from(JSON.stringify({ uid: steamId, steamId, provider: 'steam', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`;
}

// Just enough of demo_uploads / demo_files to follow the upload flow's statements.
function fakeDatabase() {
  const uploads = new Map();
  const files = new Map();
  const query = jest.fn(async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    // Like Postgres, refuse NUL characters in text and JSONB values.
    if (JSON.stringify(params).includes('\\u0000')) throw new Error('unsupported Unicode escape sequence');
    const rows = [];
    if (/^UPDATE demo_uploads SET state = \$\d+, session_uri = NULL/.test(q)) {
      const state = params[params.length - 1];
      for (const upload of uploads.values()) {
        if (upload.state !== 'uploading') continue;
        const hit = /updated_at < NOW/.test(q) ? upload.stale
          : /id = \$1 AND steam_id = \$2/.test(q) ? upload.id === params[0] && upload.steam_id === params[1]
            : upload.steam_id === params[0];
        if (!hit) continue;
        rows.push({ session_uri: upload.session_uri });
        Object.assign(upload, { state, session_uri: null });
      }
      return { rows };
    }
    if (/^SELECT name FROM demo_files WHERE \(name = \$1 OR original_name = \$1\) AND size = \$2/.test(q)) {
      return { rows: [...files.values()].filter(f => (f.name === params[0] || f.original_name === params[0]) && Number(f.size) === params[1]).map(f => ({ name: f.name })) };
    }
    if (/COUNT\(\*\) FILTER/.test(q)) {
      const all = [...uploads.values()];
      const mine = all.filter(u => u.steam_id === params[0]);
      return { rows: [{ today: mine.filter(u => u.state === 'complete').length, attempts: mine.length, active: all.filter(u => u.state === 'uploading' && u.steam_id !== params[0]).length }] };
    }
    if (/^INSERT INTO demo_uploads/.test(q)) {
      const [id, steam_id, demo_name, object_name, original_name, size, session_uri, platform, analysis_source, recorded_at, scan] = params;
      uploads.set(id, { id, steam_id, demo_name, object_name, original_name, size: String(size), received: '0', session_uri, state: 'uploading', platform, analysis_source, recorded_at, scan, header: null, fingerprint: null, error: null });
      return { rows };
    }
    if (/^SELECT \* FROM demo_uploads WHERE id = \$1/.test(q)) {
      const upload = uploads.get(params[0]);
      return { rows: upload ? [JSON.parse(JSON.stringify(upload))] : [] };
    }
    if (/^SELECT name FROM demo_files WHERE fingerprint = \$1/.test(q)) {
      const file = [...files.values()].find(f => f.fingerprint === params[0]);
      const upload = [...uploads.values()].find(u => u.fingerprint === params[0] && u.state === 'uploading' && u.id !== params[1]);
      return { rows: file ? [{ name: file.name }] : upload ? [{ name: upload.demo_name }] : [] };
    }
    if (/^UPDATE demo_uploads SET state = 'rejected'/.test(q)) {
      Object.assign(uploads.get(params[0]), { state: 'rejected', error: params[1], session_uri: null });
      return { rows };
    }
    if (/^SELECT display_name FROM steam_members/.test(q)) return { rows: [{ display_name: 'Uploader' }] };
    if (/^INSERT INTO demo_files/.test(q)) {
      const [name, object_name, size, map_name, recorded_at, recording_state, uploaded_by, uploader_name, source_platform, analysis_source, fingerprint, original_name, server_name] = params;
      const row = { name, object_name, size, map_name, recorded_at, recording_state, uploaded_by, uploader_name, source_platform, analysis_source, fingerprint, original_name, server_name, origin: 'upload', archive_state: 'verified', analysis_state: 'none' };
      files.set(name, row);
      return { rows: [{ name, map_name, recorded_at, recording_state, analysis_state: 'none' }] };
    }
    if (/^UPDATE demo_uploads SET state = 'complete'/.test(q)) {
      const upload = uploads.get(params[0]);
      Object.assign(upload, { state: 'complete', received: upload.size, scan: params[1], session_uri: null });
      return { rows };
    }
    if (/^UPDATE demo_uploads SET received = \$2/.test(q)) {
      const upload = uploads.get(params[0]);
      if (upload && upload.state === 'uploading' && Number(upload.received) === params[5]) {
        Object.assign(upload, { received: String(params[1]), scan: params[2], header: params[3], fingerprint: params[4] });
      }
      return { rows };
    }
    throw new Error(`Unexpected SQL in test: ${q.slice(0, 90)}`);
  });
  return { query, uploads, files };
}

// Mirrors a Cloud Storage resumable session: bytes must arrive in order, the object exists only when complete.
function fakeStorage() {
  const sessions = new Map();
  const objects = new Map();
  const cancelled = [];
  let count = 0;
  const storage = {
    sessions, objects, cancelled, dropNextResponse: false,
    async startUpload({ objectName, size }) {
      const uri = `https://storage.googleapis.com/upload/storage/v1/b/test/o?uploadType=resumable&upload_id=${++count}`;
      sessions.set(uri, { objectName, size, parts: [], persisted: 0 });
      return uri;
    },
    async putChunk(uri, buffer, start, total) {
      const s = sessions.get(uri);
      if (!s || s.cancelled) throw new StorageError(404, 'no such session');
      if (start !== s.persisted) throw new StorageError(400, `expected ${s.persisted}`);
      s.parts.push(Buffer.from(buffer));
      s.persisted += buffer.length;
      if (s.persisted === total) objects.set(s.objectName, Buffer.concat(s.parts));
      if (storage.dropNextResponse) { storage.dropNextResponse = false; throw new TypeError('fetch failed'); }
      return s.persisted === total ? { done: true, persisted: total, object: { size: String(total) } } : { done: false, persisted: s.persisted };
    },
    async queryUpload(uri, total) {
      const s = sessions.get(uri);
      return s.persisted === total ? { done: true, persisted: total, object: { size: String(total) } } : { done: false, persisted: s.persisted };
    },
    async cancelUpload(uri) { cancelled.push(uri); const s = sessions.get(uri); if (s) s.cancelled = true; },
    deleteObject: jest.fn(async name => { objects.delete(name); }),
  };
  return storage;
}

function buildApp({ pool = fakeDatabase(), storage = fakeStorage() } = {}) {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const app = express(); app.use(express.json());
  registerDemoUploadRoutes(app, { pool, storage, lookupRoster: steamId => (steamId === OUTSIDER ? null : { steamId }) });
  return { app, pool, storage };
}

const as = (steamId = MEMBER) => r => r.set('Authorization', `Bearer ${secret}`).set('x-game-session', session(steamId));
const start = (app, body, steamId) => as(steamId)(request(app).post('/demo-uploads')).send({ platform: 'xplay', recordedAt: '2026-09-20T19:30:00.000Z', ...body });
const put = (app, id, offset, buffer, steamId) => as(steamId)(request(app).put(`/demo-uploads/${id}?offset=${offset}`)).set('Content-Type', 'application/octet-stream').send(buffer);

async function uploadAll(app, id, demo, from = 0) {
  let response;
  for (let offset = from; offset < demo.length; offset += CHUNK) {
    response = await put(app, id, offset, demo.subarray(offset, offset + CHUNK));
    if (response.status !== 200) return response;
  }
  return response;
}

const bigDemo = (seed = 0) => syntheticDemo({ packets: 95, packetBytes: 100000 + seed });

afterEach(() => {
  delete process.env.DEMO_UPLOADS_ENABLED;
  delete process.env.DEMO_UPLOAD_DAILY_LIMIT;
});

test('starting an upload needs the website token, a member session and a plausible .dem file', async () => {
  const { app } = buildApp();
  const ok = { fileName: 'match.dem', size: 5 * 1024 * 1024 };
  await request(app).post('/demo-uploads').send(ok).expect(403);
  await request(app).post('/demo-uploads').set('Authorization', `Bearer ${secret}`).send(ok).expect(401);
  expect((await start(app, ok, OUTSIDER).expect(403)).body.error).toMatch(/üye/);
  expect((await start(app, { ...ok, fileName: 'match.dem.zip' }).expect(415)).body.code).toBe('extension');
  expect((await start(app, { ...ok, fileName: 'match.exe' }).expect(415)).body.code).toBe('extension');
  expect((await start(app, { ...ok, size: 1000 }).expect(400)).body.code).toBe('too_small');
  expect((await start(app, { ...ok, size: 2 * 1024 ** 3 }).expect(413)).body.code).toBe('too_large');
  await start(app, { ...ok, size: '5000000' }).expect(400);
  await start(app, { ...ok, platform: 'steam' }).expect(400);
  await start(app, { ...ok, source: '--force' }).expect(400);
  await start(app, { ...ok, recordedAt: '2020-01-01T00:00:00Z' }).expect(400);
  await start(app, { ...ok, recordedAt: undefined }).expect(400);
  process.env.DEMO_UPLOADS_ENABLED = 'false';
  await start(app, ok).expect(503);
  expect(cleanFileName('C:\\Users\\me\\Downloads\\..\\match\u0000.dem')).toBe('match.dem');
});

test('a demo is uploaded in 4 MiB chunks, each checked and relayed, and joins the archive as an upload', async () => {
  const { app, pool, storage } = buildApp();
  const demo = bigDemo();
  const started = await start(app, { fileName: 'xplay-match-123.dem', size: demo.length }).expect(201);
  const { id, name, chunkSize } = started.body;
  expect(chunkSize).toBe(CHUNK);
  expect(name).toMatch(/^xplay_2026-09-20_19-30-00_[0-9a-f]{8}\.dem$/);

  expect((await put(app, id, CHUNK, demo.subarray(CHUNK, 2 * CHUNK)).expect(409)).body.received).toBe(0);
  await put(app, id, 0, demo.subarray(0, 1000)).expect(400);
  await put(app, id, 0, demo.subarray(0, CHUNK), OTHER).expect(404);
  await put(app, 'not-an-id', 0, demo.subarray(0, CHUNK)).expect(400);

  const first = await put(app, id, 0, demo.subarray(0, CHUNK)).expect(200);
  expect(first.body).toEqual({ received: CHUNK, done: false });
  // A retry of a chunk the server already has resynchronises the client instead of duplicating bytes.
  expect((await put(app, id, 0, demo.subarray(0, CHUNK)).expect(409)).body.received).toBe(CHUNK);
  const last = await uploadAll(app, id, demo, CHUNK);
  expect(last.status).toBe(200);
  expect(last.body).toMatchObject({ received: demo.length, done: true, demo: { name, map_name: 'de_mirage', recording_state: 'uploaded' } });

  expect(storage.objects.get(`uploads/${name}`).equals(demo)).toBe(true);
  expect(pool.files.get(name)).toMatchObject({
    object_name: `uploads/${name}`, origin: 'upload', uploaded_by: MEMBER, uploader_name: 'Uploader', source_platform: 'xplay',
    analysis_source: 'matchzy', original_name: 'xplay-match-123.dem', server_name: 'XPLAY.GG | 5v5 Competitive #12',
  });
  expect(pool.uploads.get(id)).toMatchObject({ state: 'complete', session_uri: null });
  await put(app, id, demo.length, Buffer.alloc(1)).expect(410);
});

test('files that are not demos are refused on the first chunk and never become an object', async () => {
  const { app, pool, storage } = buildApp();
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(2 * 1024 * 1024)]);
  const { id } = (await start(app, { fileName: 'renamed.dem', size: zip.length }).expect(201)).body;
  const refused = await put(app, id, 0, zip).expect(422);
  expect(refused.body.code).toBe('archive');
  expect(refused.body.error).toMatch(/ZIP/);
  expect(pool.uploads.get(id).state).toBe('rejected');
  expect(storage.cancelled).toHaveLength(1);
  expect(storage.objects.size).toBe(0);
  expect((await put(app, id, 0, zip).expect(410)).body.error).toMatch(/ZIP/);
});

test('a genuine header followed by something else is caught mid-upload and the session is cancelled', async () => {
  const { app, storage } = buildApp();
  const demo = bigDemo();
  const polyglot = Buffer.concat([demo.subarray(0, CHUNK), Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(CHUNK, 0xff)]);
  const { id } = (await start(app, { fileName: 'match.dem', size: polyglot.length }).expect(201)).body;
  // The first 4 MiB are real frames, but a frame straddles the boundary, so the walk resumes inside the tail.
  await put(app, id, 0, polyglot.subarray(0, CHUNK)).expect(200);
  const refused = await put(app, id, CHUNK, polyglot.subarray(CHUNK, 2 * CHUNK)).expect(422);
  expect(refused.body.code).toBe('corrupt');
  expect(storage.cancelled).toHaveLength(1);
  expect(storage.objects.size).toBe(0);
});

test('the same demo cannot be uploaded twice, and daily quotas apply', async () => {
  const { app, pool } = buildApp();
  const demo = bigDemo();
  const { id } = (await start(app, { fileName: 'night.dem', size: demo.length }).expect(201)).body;
  await uploadAll(app, id, demo);
  // Same file name and size: refused before any bytes move.
  expect((await start(app, { fileName: 'night.dem', size: demo.length }, OTHER).expect(409)).body.code).toBe('duplicate');
  // Renamed copy: refused by content fingerprint on the first chunk.
  const again = (await start(app, { fileName: 'renamed-night.dem', size: demo.length }, OTHER).expect(201)).body;
  expect((await put(app, again.id, 0, demo.subarray(0, CHUNK), OTHER).expect(422)).body.code).toBe('duplicate');

  process.env.DEMO_UPLOAD_DAILY_LIMIT = '1';
  expect((await start(app, { fileName: 'another.dem', size: demo.length }).expect(429)).body.code).toBe('daily_limit');
  // Starting a new upload supersedes the member's unfinished one, but a refused start leaves it alone.
  delete process.env.DEMO_UPLOAD_DAILY_LIMIT;
  const one = (await start(app, { fileName: 'a.dem', size: demo.length }, OTHER).expect(201)).body;
  await start(app, { fileName: 'night.dem', size: demo.length }, OTHER).expect(409);
  expect(pool.uploads.get(one.id).state).toBe('uploading');
  await start(app, { fileName: 'b.dem', size: demo.length }, OTHER).expect(201);
  expect(pool.uploads.get(one.id).state).toBe('cancelled');
  const cancel = await as(OTHER)(request(app).delete(`/demo-uploads/${one.id}`)).expect(200);
  expect(cancel.body.cancelled).toBe(false);
});

test('a chunk whose storage response was lost is confirmed from the session status', async () => {
  const { app, storage } = buildApp();
  const demo = bigDemo(1);
  const { id } = (await start(app, { fileName: 'flaky.dem', size: demo.length }).expect(201)).body;
  storage.dropNextResponse = true;
  expect((await put(app, id, 0, demo.subarray(0, CHUNK)).expect(200)).body.received).toBe(CHUNK);
  expect((await uploadAll(app, id, demo, CHUNK)).body.done).toBe(true);
});

test('the relay sends only what the session is missing when storage keeps part of a chunk', async () => {
  const puts = [];
  let persisted = 0;
  const storage = {
    queryUpload: async () => ({ done: false, persisted }),
    putChunk: async (uri, buffer, start) => {
      puts.push([start, buffer.length]);
      // Keep only the first 256 KiB of the first request, like a 308 with a short Range.
      persisted = start + (puts.length === 1 ? 256 * 1024 : buffer.length);
      return { done: false, persisted };
    },
  };
  const chunk = Buffer.alloc(1024 * 1024);
  expect(await forwardChunk(storage, 'uri', chunk, 0, 10 * 1024 * 1024)).toEqual({ done: false, persisted: 1024 * 1024 });
  expect(puts).toEqual([[0, 1024 * 1024], [256 * 1024, 768 * 1024]]);
  // A retried chunk that is already stored is not sent again.
  expect(await forwardChunk(storage, 'uri', chunk, 0, 10 * 1024 * 1024)).toEqual({ done: false, persisted: 1024 * 1024 });
  expect(puts).toHaveLength(2);
  // Missing earlier bytes cannot be repaired from this chunk.
  await expect(forwardChunk(storage, 'uri', chunk, 2 * 1024 * 1024, 10 * 1024 * 1024)).rejects.toMatchObject({ status: 409 });
});

test('uploaded demos reach the worker with a signed link, the match time and the analysis source; admins switch sources and delete uploads', async () => {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { email: 'backend@example.iam.gserviceaccount.com', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const name = 'xplay_2026-09-20_19-30-00_0123abcd.dem';
  let admin = true;
  let row = { origin: 'upload', object_name: `uploads/${name}`, analysis_state: 'none' };
  const query = jest.fn(async (sql, params) => {
    if (/FROM steam_members/.test(sql)) return { rows: admin ? [{}] : [] };
    if (/WHERE analysis_state = 'queued' ORDER BY/.test(sql)) {
      return { rows: [
        { name, objectName: `uploads/${name}`, force: false, onGameServer: false, source: 'auto', origin: 'upload', recordedAt: new Date('2026-09-20T19:30:00Z'), size: '9500000' },
        { name: 'server.dem', objectName: null, force: false, onGameServer: true, source: null, origin: 'server', recordedAt: null, size: '10' },
      ] };
    }
    if (/SELECT analysis_state, checksum/.test(sql)) return { rows: [{ analysis_state: 'none', checksum: null, on_game_server: false, object_name: `uploads/${name}` }] };
    if (/SET analysis_state = 'queued', analysis_force = \$2/.test(sql)) return { rows: [{ name: params[0], analysis_state: 'queued', analysis_source: params[3] || 'matchzy' }] };
    if (/SELECT origin, object_name, analysis_state FROM demo_files/.test(sql)) return { rows: [row] };
    return { rows: [] };
  });
  const storage = fakeStorage();
  const app = express(); app.use(express.json());
  registerDemoRoutes(app, { pool: { query }, account, storage, listObjects: async () => [], now: () => new Date('2026-09-21T10:00:00Z') });
  const auth = r => r.set('Authorization', `Bearer ${secret}`).set('x-game-session', session());

  const sync = await request(app).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`).send({ busy: false, demos: [] }).expect(200);
  const [upload, server] = sync.body.jobs;
  expect(upload).toMatchObject({ name, source: 'auto', recordedAt: '2026-09-20T19:30:00.000Z', size: 9500000 });
  expect(upload.downloadUrl).toMatch(new RegExp(`^https://storage\\.googleapis\\.com/csbatagi-demos/uploads/${name}\\?`));
  expect(new URL(upload.downloadUrl).searchParams.get('X-Goog-Expires')).toBe('7200');
  expect(server).toEqual({ name: 'server.dem', objectName: null, force: false, onGameServer: true, source: 'matchzy' });

  await auth(request(app).post(`/demos/${name}/analyze`)).send({ source: 'hltv' }).expect(400);
  const queued = await auth(request(app).post(`/demos/${name}/analyze`)).send({ source: 'matchzy' }).expect(200);
  expect(queued.body.demo.analysis_source).toBe('matchzy');
  expect(query.mock.calls.find(([sql]) => /analysis_source = COALESCE\(\$4/.test(sql))[1][3]).toBe('matchzy');

  const listing = await auth(request(app).get('/demos')).expect(200);
  expect(listing.body.uploads).toMatchObject({ enabled: true, chunkBytes: CHUNK, maxBytes: 1024 ** 3 });

  admin = false;
  await auth(request(app).delete(`/demos/${name}`)).expect(403);
  admin = true;
  row = { origin: 'server', object_name: 'resurrection/x.dem', analysis_state: 'none' };
  await auth(request(app).delete('/demos/x.dem')).expect(403);
  row = { origin: 'upload', object_name: `uploads/${name}`, analysis_state: 'queued' };
  await auth(request(app).delete(`/demos/${name}`)).expect(409);
  row = { origin: 'upload', object_name: `uploads/${name}`, analysis_state: 'analyzed' };
  await auth(request(app).delete(`/demos/${name}`)).expect(200);
  expect(storage.deleteObject).toHaveBeenCalledWith(`uploads/${name}`);
  expect(query.mock.calls.some(([sql, params]) => /DELETE FROM demo_files WHERE name = \$1/.test(sql) && params[0] === name)).toBe(true);
});

test('the Cloud Storage client speaks the resumable protocol, including 308 progress replies', async () => {
  const received = [];
  let total = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const base = `http://127.0.0.1:${server.address().port}`;
      if (req.method === 'POST') {
        expect(req.headers.authorization).toBe('Bearer token-1');
        expect(req.headers['x-upload-content-length']).toBe('10');
        expect(JSON.parse(body)).toMatchObject({ name: 'uploads/a.dem', contentDisposition: 'attachment' });
        res.writeHead(200, { Location: `${base}/upload/storage/v1/b/test-bucket/o?uploadType=resumable&upload_id=xyz` }).end();
        return;
      }
      if (req.method === 'DELETE') { res.writeHead(req.url.startsWith('/storage/v1/b/test-bucket/o/uploads%2Fa.dem') ? 204 : 499).end(); return; }
      const range = req.headers['content-range'];
      if (range === 'bytes */10') {
        res.writeHead(308, total ? { Range: `bytes=0-${total - 1}` } : {}).end();
        return;
      }
      received.push(body);
      total += body.length;
      if (total === 10) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'uploads/a.dem', size: '10' }));
      else res.writeHead(308, { Range: `bytes=0-${total - 1}` }).end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const storage = gcsStorage({ bucket: 'test-bucket', apiBase: `http://127.0.0.1:${server.address().port}`, accessToken: async () => 'token-1' });
    const uri = await storage.startUpload({ objectName: 'uploads/a.dem', size: 10, metadata: {} });
    expect(await storage.queryUpload(uri, 10)).toEqual({ done: false, persisted: 0 });
    expect(await storage.putChunk(uri, Buffer.from('01234'), 0, 10)).toEqual({ done: false, persisted: 5 });
    expect(await storage.queryUpload(uri, 10)).toEqual({ done: false, persisted: 5 });
    const done = await storage.putChunk(uri, Buffer.from('56789'), 5, 10);
    expect(done).toMatchObject({ done: true, persisted: 10 });
    expect(Buffer.concat(received).toString()).toBe('0123456789');
    await storage.cancelUpload(uri);
    await storage.deleteObject('uploads/a.dem');
    // Only session URLs on the storage host are ever written to.
    await expect(storage.putChunk('https://evil.example/upload', Buffer.from('x'), 0, 1)).rejects.toThrow(/unexpected upload session URL/);
  } finally {
    server.close();
  }
});

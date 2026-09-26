const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { parseDemoName, isDemoName, signedDownloadUrl, autoQueueCandidates, registerDemoRoutes } = require('../demoRoutes');

const secret = 'test-only-demo-key';
function session(email = 'member@example.test') {
  const h = Buffer.from('{}').toString('base64url');
  const b = Buffer.from(JSON.stringify({ uid: '76561198000000001', steamId: '76561198000000001', provider: 'steam', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`;
}

test('parses MatchZy demo names with and without the archive suffix', () => {
  const modern = parseDemoName('2026-09-10_20-26-34_1789071921_de_dust2_CSBatagi_Dummy_CT_vs_CSBatagi_Dummy_T_67649dfa.dem');
  expect(modern).toMatchObject({ matchId: 1789071921, map: 'de_dust2', team1: 'CSBatagi Dummy CT', team2: 'CSBatagi Dummy T' });
  expect(modern.recordedAt.toISOString()).toBe('2026-09-10T20:26:34.000Z');
  expect(parseDemoName('2025-01-21_19-42-20_11_de_anubis_team_bobi_vs_team_Nerull.dem')).toMatchObject({ matchId: 11, map: 'de_anubis', team1: 'team bobi', team2: 'team Nerull' });
  expect(parseDemoName('2025-01-28_20-13-50_21_de_tuscan_d_team_eskisigibi_vs_team_candeha.dem')).toMatchObject({ map: 'de_tuscan_d', team1: 'team eskisigibi' });
  expect(parseDemoName('2025-02-11_21-10-27_-1_de_train_team_Nerull_vs_team_ekl1ps.dem')).toMatchObject({ matchId: -1, map: 'de_train' });
  expect(parseDemoName('CSBatagi-10v10-dummy-dust2.dem')).toMatchObject({ matchId: null, map: null, recordedAt: null });
});

test('demo names cannot escape the demo directory or carry query syntax', () => {
  expect(isDemoName('2025-01-21_19-42-20_11_de_anubis_team_bobi_vs_team_Nerull.dem')).toBe(true);
  expect(isDemoName('Kabile_1_vs_Şahin.dem')).toBe(true);
  expect(isDemoName('../secrets.dem')).toBe(false);
  expect(isDemoName('a/b.dem')).toBe(false);
  expect(isDemoName('demo.dem?x=1')).toBe(false);
  expect(isDemoName('notes.txt')).toBe(false);
});

test('signed URLs follow the V4 layout and verify against the account public key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { email: 'backend@example.iam.gserviceaccount.com', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const signed = signedDownloadUrl('resurrection/2026-09-10_20-26-34_1_de_dust2_A_vs_B_67649dfa.dem', { account, now: new Date('2026-09-10T20:30:00Z'), filename: 'demo "1".dem', bucket: 'demo-bucket' });
  const url = new URL(signed.url);
  expect(url.host).toBe('storage.googleapis.com');
  expect(url.pathname).toBe('/demo-bucket/resurrection/2026-09-10_20-26-34_1_de_dust2_A_vs_B_67649dfa.dem');
  expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
  expect(url.searchParams.get('X-Goog-Credential')).toBe(`${account.email}/20260910/auto/storage/goog4_request`);
  expect(url.searchParams.get('X-Goog-Date')).toBe('20260910T203000Z');
  expect(url.searchParams.get('X-Goog-Expires')).toBe('900');
  expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="demo 1.dem"');
  expect(signed.expiresAt.toISOString()).toBe('2026-09-10T20:45:00.000Z');
  const [, canonicalPath, canonicalQuery] = signed.canonicalRequest.split('\n');
  expect(canonicalPath).toBe(url.pathname);
  expect(canonicalQuery.split('&').map(p => p.split('=')[0])).toEqual(['X-Goog-Algorithm', 'X-Goog-Credential', 'X-Goog-Date', 'X-Goog-Expires', 'X-Goog-SignedHeaders', 'response-content-disposition']);
  expect(signed.stringToSign.split('\n')[3]).toBe(crypto.createHash('sha256').update(signed.canonicalRequest).digest('hex'));
  const ok = crypto.verify('RSA-SHA256', Buffer.from(signed.stringToSign), publicKey, Buffer.from(url.searchParams.get('X-Goog-Signature'), 'hex'));
  expect(ok).toBe(true);
});

test('only finished, archived recordings of website matches are queued automatically', () => {
  const matchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-demo-test-'));
  fs.writeFileSync(path.join(matchDir, '42.json'), '{}');
  const stamp = '2026-09-12_20-00-00';
  const demos = [
    { name: `${stamp}_42_de_dust2_A_vs_B_0000aaaa.dem`, recordingState: 'map-ended', archiveState: 'verified', matchId: 42 },
    { name: `${stamp}_42_de_dust2_A_vs_B_0000bbbb.dem`, recordingState: 'interrupted', archiveState: 'verified', matchId: 42 },
    { name: `${stamp}_42_de_dust2_A_vs_B_0000cccc.dem`, recordingState: 'map-ended', archiveState: 'pending', matchId: 42 },
    { name: `${stamp}_99_de_dust2_A_vs_B_0000dddd.dem`, recordingState: 'map-ended', archiveState: 'verified', matchId: 99 },
    { name: `${stamp}_42_de_dust2_A_vs_B_0000eeee.dem`, recordingState: 'map-ended', archiveState: 'verified', matchId: null },
    // Resurrection bot tests were website matches too, but they predate the cutoff.
    { name: '2026-09-10_20-26-34_42_de_dust2_CSBatagi_Dummy_CT_vs_CSBatagi_Dummy_T_67649dfa.dem', recordingState: 'map-ended', archiveState: 'verified', matchId: 42 },
    { name: 'unparseable.dem', recordingState: 'map-ended', archiveState: 'verified', matchId: 42 },
  ];
  expect(autoQueueCandidates(demos, matchDir)).toEqual([`${stamp}_42_de_dust2_A_vs_B_0000aaaa.dem`]);
});

function buildApp(pool) {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const app = express(); app.use(express.json());
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { email: 'backend@example.iam.gserviceaccount.com', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  registerDemoRoutes(app, { pool, account, listObjects: async () => [], now: () => new Date('2026-09-10T20:30:00Z') });
  return app;
}

test('listing and download links need a signed session; analysis requests need an admin', async () => {
  const query = jest.fn(async sql => {
    if (/FROM steam_members/.test(sql)) return { rows: [] };
    if (/SELECT object_name FROM demo_files/.test(sql)) return { rows: [{ object_name: 'resurrection/x.dem' }] };
    if (/SELECT analysis_state, checksum/.test(sql)) return { rows: [{ analysis_state: 'none', checksum: null, on_game_server: true, object_name: null }] };
    return { rows: [] };
  });
  const app = buildApp({ query });
  await request(app).get('/demos').expect(403);
  await request(app).get('/demos').set('Authorization', `Bearer ${secret}`).expect(401);
  const listing = await request(app).get('/demos').set('Authorization', `Bearer ${secret}`).set('x-game-session', session()).expect(200);
  expect(listing.body.demos).toEqual([]);
  await request(app).get('/demos/x.dem/download').set('Authorization', `Bearer ${secret}`).expect(401);
  const link = await request(app).get('/demos/x.dem/download').set('Authorization', `Bearer ${secret}`).set('x-game-session', session()).expect(200);
  expect(link.body.url).toContain('https://storage.googleapis.com/csbatagi-demos/resurrection/x.dem?');
  await request(app).get('/demos/..%2Fx.dem/download').set('Authorization', `Bearer ${secret}`).set('x-game-session', session()).expect(400);
  await request(app).post('/demos/x.dem/analyze').set('Authorization', `Bearer ${secret}`).set('x-game-session', session()).expect(403);
});

test('admins queue analysis once; the worker sync hands the job out and the result is verified in the database', async () => {
  const state = { analysis_state: 'none', checksum: null, on_game_server: true, object_name: null };
  const query = jest.fn(async (sql, params) => {
    if (/FROM steam_members/.test(sql)) return { rows: [{}] };
    if (/SELECT analysis_state, checksum/.test(sql)) return { rows: [{ ...state }] };
    if (/SET analysis_state = 'queued', analysis_force = \$2/.test(sql)) { state.analysis_state = 'queued'; return { rows: [{ name: params[0], analysis_state: 'queued', analysis_force: params[1], analysis_requested_by: params[2] }] }; }
    if (/WHERE analysis_state = 'queued' ORDER BY/.test(sql)) return { rows: state.analysis_state === 'queued' ? [{ name: 'x.dem', objectName: null, force: false, onGameServer: true }] : [] };
    if (/FROM matches WHERE right\(demo_path/.test(sql)) return { rows: params[0] === 'x.dem' ? [{ checksum: 'abc123' }] : [] };
    if (/SET analysis_state = 'analyzed'/.test(sql)) { state.analysis_state = 'analyzed'; state.checksum = params[1]; return { rows: [] }; }
    if (/WHERE f.name = \$1/.test(sql)) return { rows: [{ name: params[0], analysis_state: state.analysis_state, checksum: state.checksum }] };
    return { rows: [] };
  });
  const app = buildApp({ query });
  const auth = r => r.set('Authorization', `Bearer ${secret}`).set('x-game-session', session('admin@example.test'));
  const queued = await auth(request(app).post('/demos/x.dem/analyze')).expect(200);
  expect(queued.body.demo).toMatchObject({ analysis_state: 'queued', analysis_force: false, analysis_requested_by: '76561198000000001' });
  await auth(request(app).post('/demos/x.dem/analyze')).expect(409);

  const sync = await request(app).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`)
    .send({ busy: false, demos: [{ name: 'x.dem', size: 10, recordingState: 'map-ended', matchId: 5, archiveState: 'verified' }] }).expect(200);
  expect(query.mock.calls.some(([sql]) => /analysis_requested_by = 'auto'/.test(sql))).toBe(false);
  const listing = await auth(request(app).get('/demos')).expect(200);
  expect(listing.body.autoAnalyze).toBe(false);
  expect(sync.body.jobs).toEqual([{ name: 'x.dem', objectName: null, force: false, onGameServer: true, source: 'matchzy' }]);
  const busy = await request(app).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`).send({ busy: true, demos: [] }).expect(200);
  expect(busy.body.jobs).toEqual([]);
  await request(app).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`).send({ demos: [{ name: '../x.dem' }] }).expect(200);

  await request(app).post('/demo-analysis/result').set('Authorization', `Bearer ${secret}`).send({ name: 'x.dem', state: 'bogus' }).expect(400);
  const done = await request(app).post('/demo-analysis/result').set('Authorization', `Bearer ${secret}`).send({ name: 'x.dem', state: 'analyzed' }).expect(200);
  expect(done.body).toMatchObject({ analysis_state: 'analyzed', checksum: 'abc123' });
  const failedCall = query.mock.calls.find(([sql]) => /not in the database/.test(sql) || (/SET analysis_state = 'failed'/.test(sql)));
  expect(failedCall).toBeUndefined();
});

test('automatic queueing happens only with DEMO_AUTO_ANALYZE=true, for website matches after the cutoff', async () => {
  const matchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-demo-auto-'));
  fs.writeFileSync(path.join(matchDir, '7.json'), '{}');
  process.env.CS2_MATCH_DIR = matchDir;
  const name = '2026-09-12_21-00-00_7_de_mirage_Kabile_1_vs_Kabile_2_0000ffff.dem';
  const inventory = { busy: false, demos: [{ name, size: 10, recordingState: 'map-ended', matchId: 7, archiveState: 'verified' }] };
  const queuedSql = ([sql]) => /analysis_requested_by = 'auto'/.test(sql);
  try {
    delete process.env.DEMO_AUTO_ANALYZE;
    const off = jest.fn(async () => ({ rows: [] }));
    await request(buildApp({ query: off })).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`).send(inventory).expect(200);
    expect(off.mock.calls.some(queuedSql)).toBe(false);

    process.env.DEMO_AUTO_ANALYZE = 'true';
    const on = jest.fn(async () => ({ rows: [] }));
    await request(buildApp({ query: on })).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`).send(inventory).expect(200);
    const call = on.mock.calls.find(queuedSql);
    expect(call && call[1]).toEqual([[name]]);
  } finally {
    delete process.env.DEMO_AUTO_ANALYZE;
    delete process.env.CS2_MATCH_DIR;
  }
});

test('a reported success without a database row is recorded as a failure', async () => {
  const updates = [];
  const query = jest.fn(async (sql, params) => {
    if (/FROM matches WHERE right\(demo_path/.test(sql)) return { rows: [] };
    if (/UPDATE demo_files SET/.test(sql)) { updates.push([sql, params]); return { rows: [] }; }
    if (/WHERE f.name = \$1/.test(sql)) return { rows: [{ name: params[0], analysis_state: 'failed' }] };
    return { rows: [] };
  });
  const app = buildApp({ query });
  const report = await request(app).post('/demo-analysis/result').set('Authorization', `Bearer ${secret}`).send({ name: 'y.dem', state: 'analyzed' }).expect(200);
  expect(report.body.analysis_state).toBe('failed');
  expect(updates.some(([sql, params]) => /analysis_state = 'failed'/.test(sql) && /not in the database/.test(params[1]))).toBe(true);
});

test('a success report without a database row keeps what the CLI said', async () => {
  const errors = [];
  const query = jest.fn(async (sql, params) => {
    if (/FROM matches WHERE right\(demo_path/.test(sql)) return { rows: [] };
    if (/UPDATE demo_files SET analysis_state = 'failed'/.test(sql)) errors.push(params[1]);
    return { rows: [] };
  });
  const app = buildApp({ query });
  const send = log => request(app).post('/demo-analysis/result').set('Authorization', `Bearer ${secret}`).send({ name: 'y.dem', state: 'analyzed', log }).expect(200);

  await send('1 demos to process\nAnalyzing demo /x/y.dem...\nInserting match into database /x/y.dem...\npermission denied for table rounds');
  expect(errors[0]).toMatch(/not in the database\. CS Demo Manager said: .*permission denied for table rounds$/s);

  await send('1 demos to process\nDemo /x/y.dem already in database, skipping this demo.');
  expect(errors[1]).toMatch(/skipped it: a demo with the same checksum is already in the database/);

  await send('x'.repeat(5000));
  expect(errors[2].length).toBeLessThan(800);
});

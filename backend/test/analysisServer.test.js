const { createAnalysisServer, ServerBusy } = require('../analysisServer');

const MINUTE = 60 * 1000;

// A game VM, its RCON status, the demo queue and a clock, all under the test's control.
function setup({ vm = 'TERMINATED', game = { humans: 0, live: false, preparing: false, recording: false } } = {}) {
  const world = { vm, game, rconUp: true, queued: 0, analyzing: 0, time: Date.parse('2026-09-26T19:00:00Z') };
  const row = {};
  const store = {
    row,
    load: async () => ({ auto_stop: false, start_pending: false, started_at: null, started_by: null, running_seen_at: null, idle_since: null, busy_reason: null, last_event: null, stopped_at: null, stopped_by: null, ...row }),
    save: async patch => { Object.assign(row, patch); },
    jobCounts: async () => ({ queued: world.queued, analyzing: world.analyzing }),
  };
  const gcp = {
    getStatus: jest.fn(async () => world.vm),
    startVm: jest.fn(async () => { world.vm = 'STAGING'; return { success: true }; }),
    stopVm: jest.fn(async () => { world.vm = 'TERMINATED'; return { success: true }; }),
  };
  const rcon = {
    status: jest.fn(async () => { if (!world.rconUp) throw new Error('RCON failed'); return world.game; }),
    executeCommand: jest.fn(async () => ''),
  };
  const server = createAnalysisServer({ store, gcp, rcon, now: () => world.time, idleMs: 15 * MINUTE });
  const advance = minutes => { world.time += minutes * MINUTE; };
  return { world, store, gcp, rcon, server, advance };
}

test('"Analiz et" starts a stopped game VM and marks it as an analysis session', async () => {
  const { world, store, gcp, server } = setup();
  expect(await server.ensureRunning('76561198000000009')).toEqual({ vm: 'starting', started: true });
  await server.settled();
  expect(gcp.startVm).toHaveBeenCalledTimes(1);
  expect(store.row).toMatchObject({ auto_stop: true, started_by: '76561198000000009', last_event: 'started' });
  // A second request while it boots does not start it again.
  expect(await server.ensureRunning('76561198000000009')).toEqual({ vm: 'starting', started: false });
  expect(gcp.startVm).toHaveBeenCalledTimes(1);
  world.vm = 'RUNNING';
  expect((await server.snapshot()).vm).toBe('starting'); // cached for a few seconds
});

test('a VM already open for a match is used as is and never closed by the watcher', async () => {
  const { world, store, gcp, server, advance } = setup({ vm: 'RUNNING' });
  expect(await server.ensureRunning('76561198000000009')).toEqual({ vm: 'running', started: false });
  expect(store.row.auto_stop).toBeUndefined();
  for (let minute = 0; minute < 30; minute++) { advance(1); expect(await server.tick()).toBe('inactive'); }
  expect(gcp.stopVm).not.toHaveBeenCalled();
  expect(world.vm).toBe('RUNNING');
});

test('the analysis session closes the VM after 15 idle minutes, and any work restarts the clock', async () => {
  const { world, store, gcp, rcon, server, advance } = setup();
  world.queued = 1;
  await server.ensureRunning('admin');
  await server.settled();
  expect(await server.tick()).toBe('waiting'); // still booting
  world.vm = 'RUNNING';
  world.rconUp = false; // CS2 not up yet, no worker report: cannot confirm it is empty
  advance(1);
  expect(await server.tick()).toBe('queued');
  world.queued = 0; world.analyzing = 1;
  advance(1);
  expect(await server.tick()).toBe('analyzing');
  world.analyzing = 0;
  advance(1);
  expect(await server.tick()).toBe('unverified');
  world.rconUp = true;
  advance(1);
  expect(await server.tick()).toBe('idle');
  const idleStart = store.row.idle_since;
  advance(10);
  expect(await server.tick()).toBe('idle');
  // A second demo queued ten minutes later: the clock starts again after it.
  expect(await server.ensureRunning('admin')).toEqual({ vm: 'running', started: false });
  world.analyzing = 1;
  advance(1);
  expect(await server.tick()).toBe('analyzing');
  world.analyzing = 0;
  advance(1);
  expect(await server.tick()).toBe('idle');
  expect(store.row.idle_since.getTime()).toBeGreaterThan(idleStart.getTime());
  expect((await server.snapshot()).stopAt).toBe(new Date(store.row.idle_since.getTime() + 15 * MINUTE).toISOString());
  advance(14);
  expect(await server.tick()).toBe('idle');
  expect(gcp.stopVm).not.toHaveBeenCalled();
  advance(1);
  expect(await server.tick()).toBe('stopped');
  expect(rcon.executeCommand).toHaveBeenCalledWith('quit');
  expect(gcp.stopVm).toHaveBeenCalledTimes(1);
  expect(store.row).toMatchObject({ auto_stop: false, stopped_by: 'auto', last_event: 'auto_stopped' });
  expect((await server.snapshot())).toMatchObject({ vm: 'stopped', stoppedAutomatically: true });
  advance(1);
  expect(await server.tick()).toBe('inactive');
});

test('players, a match or a demo upload keep the VM open', async () => {
  const { world, gcp, server, advance } = setup();
  await server.ensureRunning('admin');
  await server.settled();
  world.vm = 'RUNNING';
  for (const [game, reason] of [
    [{ humans: 2, live: false }, 'players'],
    [{ humans: 0, live: true }, 'match'],
    [{ humans: 0, recording: true }, 'match'],
    [{ humans: 0, uploads: { pending: 1 } }, 'uploads'],
  ]) {
    world.game = game;
    for (let minute = 0; minute < 20; minute++) {
      advance(1);
      // The uploader rewrites its status every 30 seconds.
      if (game.uploads) game.uploads.updatedAt = world.time / 1000 - 30;
      expect(await server.tick()).toBe(reason);
    }
  }
  expect(gcp.stopVm).not.toHaveBeenCalled();
});

test('without RCON the worker report decides, and silence never counts as empty', async () => {
  const { world, gcp, server, advance } = setup();
  await server.ensureRunning('admin');
  await server.settled();
  world.vm = 'RUNNING';
  world.rconUp = false;
  server.noteWorker({ game: { running: true, humans: 1 } });
  advance(1);
  expect(await server.tick()).toBe('players');
  server.noteWorker({ game: { running: false } }); // CS2 itself is not running
  advance(1);
  expect(await server.tick()).toBe('idle');
  // The worker goes quiet too: nothing confirms the server is empty any more.
  advance(5);
  expect(await server.tick()).toBe('unverified');
  advance(30);
  expect(await server.tick()).toBe('unverified');
  expect(gcp.stopVm).not.toHaveBeenCalled();
});

test('queued jobs stop holding the VM once the boot grace passes without the worker checking in', async () => {
  const { world, gcp, server, advance } = setup();
  world.queued = 2;
  await server.ensureRunning('admin');
  await server.settled();
  world.vm = 'RUNNING';
  advance(1);
  expect(await server.tick()).toBe('queued');
  advance(20);
  expect(await server.tick()).toBe('idle');
  advance(15);
  expect(await server.tick()).toBe('stopped');
  expect(gcp.stopVm).toHaveBeenCalledTimes(1);
});

test('a request while the VM shuts down starts it again once it is off', async () => {
  const { world, store, gcp, server, advance } = setup({ vm: 'STOPPING' });
  expect(await server.ensureRunning('admin')).toEqual({ vm: 'stopping', started: false, pending: true });
  expect(await server.tick()).toBe('waiting');
  world.vm = 'TERMINATED';
  advance(1);
  expect(await server.tick()).toBe('started');
  await server.settled();
  expect(gcp.startVm).toHaveBeenCalledTimes(1);
  expect(store.row).toMatchObject({ auto_stop: true, start_pending: false });
});

test('a failed start ends the session and is reported', async () => {
  const { store, gcp, server, advance } = setup();
  gcp.startVm.mockResolvedValueOnce({ success: false, error: 'ZONE_RESOURCE_POOL_EXHAUSTED' });
  await server.ensureRunning('admin');
  await server.settled();
  expect(store.row).toMatchObject({ auto_stop: false, last_event: 'start_failed' });
  advance(5);
  expect(await server.tick()).toBe('inactive');
  expect((await server.snapshot()).lastEvent).toBe('start_failed');
});

test('closing by hand refuses while work or players remain; opening for a match ends the session', async () => {
  const { world, store, gcp, server, advance } = setup();
  await server.ensureRunning('admin');
  await server.settled();
  world.vm = 'RUNNING';
  world.queued = 1;
  await expect(server.stopNow('admin')).rejects.toBeInstanceOf(ServerBusy);
  world.queued = 0;
  world.game = { humans: 1 };
  await expect(server.stopNow('admin')).rejects.toMatchObject({ reason: 'players' });
  world.game = { humans: 0 };
  expect(await server.stopNow('76561198000000009')).toEqual({ vm: 'stopped', stopped: true });
  expect(store.row).toMatchObject({ stopped_by: '76561198000000009', auto_stop: false });
  expect(await server.stopNow('admin')).toEqual({ vm: 'stopped', stopped: false });

  await server.ensureRunning('admin');
  await server.settled();
  world.vm = 'RUNNING';
  await server.noteManualStart();
  for (let minute = 0; minute < 30; minute++) { advance(1); await server.tick(); }
  expect(gcp.stopVm).toHaveBeenCalledTimes(1);
  world.analyzing = 1;
  expect(await server.analysisRunning()).toBe(true);
});

test('DEMO_ANALYSIS_AUTOSTART=false leaves the VM alone', async () => {
  process.env.DEMO_ANALYSIS_AUTOSTART = 'false';
  try {
    const { gcp, server } = setup();
    expect(await server.ensureRunning('admin')).toEqual({ vm: 'stopped', started: false });
    expect(gcp.startVm).not.toHaveBeenCalled();
    expect((await server.snapshot()).autoStart).toBe(false);
  } finally {
    delete process.env.DEMO_ANALYSIS_AUTOSTART;
  }
});

describe('routes', () => {
  const crypto = require('crypto');
  const express = require('express');
  const request = require('supertest');
  const { registerDemoRoutes } = require('../demoRoutes');
  const { registerGameServer } = require('../gameServer');
  const secret = 'test-only-analysis-server';
  const session = () => {
    const h = Buffer.from('{}').toString('base64url');
    const b = Buffer.from(JSON.stringify({ uid: '76561198000000009', steamId: '76561198000000009', provider: 'steam', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`;
  };
  const fakeServer = () => ({
    ensureRunning: jest.fn(async () => ({ vm: 'starting', started: true })),
    stopNow: jest.fn(async () => ({ vm: 'stopped', stopped: true })),
    snapshot: jest.fn(async () => ({ vm: 'running', autoStop: true, idleMinutes: 15 })),
    noteWorker: jest.fn(), noteManualStart: jest.fn(async () => {}), noteManualStop: jest.fn(async () => {}),
    analysisRunning: jest.fn(async () => false),
  });
  let admin;
  const pool = { query: jest.fn(async sql => {
    if (/FROM steam_members/.test(sql)) return { rows: admin ? [{}] : [] };
    if (/SELECT analysis_state, checksum/.test(sql)) return { rows: [{ analysis_state: 'none', checksum: null, on_game_server: false, object_name: 'uploads/x.dem' }] };
    if (/SET analysis_state = 'queued', analysis_force/.test(sql)) return { rows: [{ name: 'x.dem', analysis_state: 'queued' }] };
    return { rows: [] };
  }) };
  function demoApp(analysisServer) {
    process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
    const app = express(); app.use(express.json());
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    registerDemoRoutes(app, { pool, analysisServer, listObjects: async () => [], account: { email: 'x@y', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) } });
    return app;
  }
  const auth = r => r.set('Authorization', `Bearer ${secret}`).set('x-game-session', session());
  beforeEach(() => { admin = true; });

  test('queueing an analysis starts the game VM and reports it; the listing carries its state', async () => {
    const analysisServer = fakeServer();
    const app = demoApp(analysisServer);
    const queued = await auth(request(app).post('/demos/x.dem/analyze')).send({}).expect(200);
    expect(queued.body.server).toEqual({ vm: 'starting', started: true });
    expect(analysisServer.ensureRunning).toHaveBeenCalledWith('76561198000000009');
    analysisServer.ensureRunning.mockRejectedValueOnce(new Error('compute API down'));
    const stillQueued = await auth(request(app).post('/demos/x.dem/analyze')).send({}).expect(200);
    expect(stillQueued.body.server).toMatchObject({ vm: 'unknown' });
    const listing = await auth(request(app).get('/demos')).expect(200);
    expect(listing.body.analysisServer).toEqual({ vm: 'running', autoStop: true, idleMinutes: 15 });
    await request(app).post('/demo-analysis/sync').set('Authorization', `Bearer ${secret}`).send({ demos: [], game: { running: true, humans: 0 } }).expect(200);
    expect(analysisServer.noteWorker).toHaveBeenCalledWith(expect.objectContaining({ game: { running: true, humans: 0 } }));
  });

  test('only admins open or close the analysis server; a busy server says why', async () => {
    const analysisServer = fakeServer();
    const app = demoApp(analysisServer);
    expect((await auth(request(app).post('/analysis-server/start')).expect(200)).body).toEqual({ vm: 'starting', started: true });
    analysisServer.stopNow.mockRejectedValueOnce(new ServerBusy('players'));
    const busy = await auth(request(app).post('/analysis-server/stop')).expect(409);
    expect(busy.body).toEqual({ error: 'Sunucuda oyuncu var.', reason: 'players' });
    await auth(request(app).post('/analysis-server/stop')).expect(200);
    await auth(request(app).post('/analysis-server/reboot')).expect(404);
    admin = false;
    await auth(request(app).post('/analysis-server/stop')).expect(403);
    await request(app).post('/analysis-server/stop').expect(403);
    expect(analysisServer.stopNow).toHaveBeenCalledTimes(2);
  });

  test('"Server Aç" ends an analysis session; "Server Kapat" waits for a running analysis', async () => {
    process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
    const analysisServer = fakeServer();
    const app = express(); app.use(express.json());
    const gcp = { startVm: jest.fn(async () => ({ success: true })), stopVm: jest.fn(async () => ({ success: true })) };
    const rcon = { status: jest.fn(async () => ({ live: false, uploads: { pending: 0, updatedAt: Date.now() / 1000 } })), executeCommand: jest.fn(async () => '') };
    registerGameServer(app, { pool: { query: jest.fn(async () => ({ rows: [{}] })) }, rcon, gcp, analysisServer, lookupRoster: () => ({}) });
    await auth(request(app).post('/start-vm')).expect(200);
    expect(analysisServer.noteManualStart).toHaveBeenCalledTimes(1);
    analysisServer.analysisRunning.mockResolvedValueOnce(true);
    expect((await auth(request(app).post('/stop-vm')).expect(409)).body.error).toMatch(/analizi sürüyor/);
    expect(gcp.stopVm).not.toHaveBeenCalled();
    await auth(request(app).post('/stop-vm')).expect(200);
    expect(analysisServer.noteManualStop).toHaveBeenCalledTimes(1);
  });
});

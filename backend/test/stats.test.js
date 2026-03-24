/*
 Minimal integration test for /stats/incremental endpoint.
 It spins up the Express app in-process and exercises the published version contract.
 Uses supertest; run via `npm test` after installing dev deps.
*/

const request = require('supertest');

describe('GET /stats/incremental (integration light)', () => {
  let app;
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_TOKEN = 'test-token';
    app = require('..');
  });

  beforeEach(() => {
    global.__testStatsState = {
      id: 1,
      dirty: false,
      status: 'idle',
      source_table: 'test',
      current_version: 1,
      last_mutation_at: new Date(Date.now() - 60000),
      last_completed_at: new Date(Date.now() - 60000),
      updated_at: new Date(Date.now() - 60000),
      last_error: null,
    };
  });

  test('returns statsVersion, serverTimestamp, and updated flag on first call', async () => {
    const res = await request(app).get('/stats/incremental');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('statsVersion', 1);
    expect(res.body).toHaveProperty('serverTimestamp');
    expect(res.body).toHaveProperty('updated');
  });

  test('second call with lastKnownVersion does not mark updated again', async () => {
    const first = await request(app).get('/stats/incremental');
    const second = await request(app).get('/stats/incremental').query({ lastKnownVersion: first.body.statsVersion });
    expect(second.status).toBe(200);
    expect(second.body.statsVersion).toBe(first.body.statsVersion);
    expect(second.body.updated).toBe(false);
    expect(second.body.serverTimestamp).toBeTruthy();
  });

  test('legacy lastKnownTs callers still get unchanged responses', async () => {
    const first = await request(app).get('/stats/incremental');
    const second = await request(app).get('/stats/incremental').query({ lastKnownTs: first.body.serverTimestamp });
    expect(second.status).toBe(200);
    expect(second.body.statsVersion).toBe(first.body.statsVersion);
    expect(second.body.updated).toBe(false);
    expect(second.body.serverTimestamp).toBe(first.body.serverTimestamp);
  });

  test('force regenerate publishes the next stats version', async () => {
    const first = await request(app).get('/stats/incremental');
    const force = await request(app)
      .post('/stats/force-regenerate')
      .set('Authorization', 'Bearer test-token');

    expect(force.status).toBe(200);
    expect(force.body.updated).toBe(true);
    expect(force.body.statsVersion).toBe(first.body.statsVersion + 1);

    const second = await request(app).get('/stats/incremental').query({ lastKnownVersion: first.body.statsVersion });
    expect(second.status).toBe(200);
    expect(second.body.updated).toBe(true);
    expect(second.body.statsVersion).toBe(force.body.statsVersion);
  });
});

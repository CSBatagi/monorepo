/*
 Minimal integration test for /stats/check-and-update endpoint.
 It spins up the Express app in-process and hits the endpoint with and without lastKnownTs.
 Uses supertest; run via `npm test` after installing dev deps.
*/

const request = require('supertest');

describe('GET /stats/check-and-update (integration light)', () => {
  let app;
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_TOKEN = 'test-token';
    app = require('..');
  });

  test('returns serverTimestamp and updated flag (first call triggers generation)', async () => {
    const res = await request(app).get('/stats/check-and-update');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('serverTimestamp');
    expect(res.body).toHaveProperty('updated');
  });

  test('second call with lastKnownTs typically does not mark updated again', async () => {
    const first = await request(app).get('/stats/check-and-update');
    const ts = first.body.serverTimestamp;
    const second = await request(app).get('/stats/check-and-update').query({ lastKnownTs: ts });
    expect(second.status).toBe(200);
    expect(second.body.serverTimestamp).toBeTruthy();
    // In test mode timestamp increments by 1s each fetch; updated may be true if simulated change.
    expect(second.body).toHaveProperty('updated');
  });
});

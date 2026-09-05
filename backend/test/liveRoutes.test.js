const express = require('express');
const request = require('supertest');
const { router, setup } = require('../liveRoutes');
let app, pool, client;
beforeEach(() => {
  client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  pool = { query: jest.fn(), connect: jest.fn().mockResolvedValue(client) };
  setup(pool); app = express(); app.use(express.json()); app.use('/live', router);
});
test('BIGINT versions are numeric and unchanged polls skip attendance reads', async () => {
  pool.query.mockResolvedValue({ rows: [{ version: '42' }] });
  const unchanged = await request(app).get('/live/attendance?v=42');
  expect(unchanged.status).toBe(304);
  expect(unchanged.headers['cache-control']).toBe('no-store');
  expect(pool.query).toHaveBeenCalledTimes(1);
  pool.query.mockResolvedValueOnce({ rows: [{ version: '43' }] }).mockResolvedValueOnce({ rows: [{ steam_id: '1', name: 'A', status: 'coming' }] });
  const changed = await request(app).get('/live/attendance?v=42');
  expect(changed.body.version).toBe(43);
  expect(changed.body.attendance['1'].status).toBe('coming');
});
test('a restored database with a lower version sends a full snapshot', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ version: '2' }] }).mockResolvedValueOnce({ rows: [] });
  const result = await request(app).get('/live/attendance?v=42');
  expect(result.status).toBe(200); expect(result.body.version).toBe(2);
});
test.each(['/live/attendance/1', '/live/attendance/reset', '/live/attendance/bulk'])('%s rolls back if version publishing fails', async url => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  client.query.mockImplementation(async sql => { if (sql.startsWith('UPDATE live_version')) throw new Error('version failed'); return { rows: [] }; });
  try {
    const result = await request(app).post(url).send({ name: 'A', status: 'coming', players: [{ steamId: '1', name: 'A' }] });
    expect(result.status).toBe(500);
    const sql = client.query.mock.calls.map(([sql]) => sql);
    expect(sql[0]).toBe('BEGIN'); expect(sql.at(-1)).toBe('ROLLBACK'); expect(sql).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});
test('successful attendance mutation commits data and version together', async () => {
  pool.query.mockResolvedValue({ rows: [{ version: '44' }] });
  const result = await request(app).post('/live/attendance/1').send({ name: 'A', status: 'coming' });
  expect(result.body).toEqual({ ok: true, version: 44 });
  const sql = client.query.mock.calls.map(([sql]) => sql);
  expect(sql[0]).toBe('BEGIN'); expect(sql[1]).toContain('INSERT INTO attendance');
  expect(sql[2]).toContain('UPDATE live_version'); expect(sql[3]).toBe('COMMIT');
});

const express = require('express');
const request = require('supertest');
const { buildMundialDraw } = require('../mundialDraw');
const { router, setup } = require('../liveRoutes');

const pot = (id, ids) => ({ id, players: ids.map((steamId) => ({ steamId, name: `p${steamId}` })) });
const POTS = [
  pot(1, ['10001', '10002', '10003', '10004']),
  pot(2, ['20001', '20002', '20003', '20004']),
  pot(3, ['30001', '30002', '30003', '30004']),
  pot(4, ['40001', '40002', '40003', '40004']),
  pot(5, ['50001', '50002', '50003']),
];

describe('buildMundialDraw', () => {
  test('places every player once, with at most one player per pot in each group', () => {
    for (let run = 0; run < 50; run++) {
      const draw = buildMundialDraw(POTS, 4);
      expect(draw.groups.map((g) => g.id)).toEqual(['A', 'B', 'C', 'D']);
      const placed = draw.groups.flatMap((g) => g.players);
      expect(placed.sort()).toEqual(POTS.flatMap((p) => p.players.map((x) => x.steamId)).sort());
      for (const group of draw.groups) {
        const pots = group.players.map((id) => id[0]);
        expect(new Set(pots).size).toBe(pots.length);
      }
      expect(draw.groups.map((g) => g.players.length).sort()).toEqual([4, 5, 5, 5]);
      expect(draw.steps).toHaveLength(19);
      // Steps are revealed pot by pot, in pot order.
      expect(draw.steps.map((s) => s.potIndex)).toEqual([...draw.steps.map((s) => s.potIndex)].sort());
    }
  });

  test('uses the injected random source for player and group balls', () => {
    const draw = buildMundialDraw([pot(1, ['10001', '10002']), pot(2, ['20001', '20002'])], 2, () => 0);
    expect(draw.steps.map((s) => [s.steamId, s.groupId])).toEqual([
      ['10001', 'A'], ['10002', 'B'], ['20001', 'A'], ['20002', 'B'],
    ]);
  });

  test('rejects oversized pots, duplicates and invalid group counts', () => {
    expect(() => buildMundialDraw([pot(1, ['10001', '10002', '10003'])], 2)).toThrow('more players than groups');
    expect(() => buildMundialDraw([pot(1, ['10001']), pot(2, ['10001'])], 2)).toThrow('duplicate');
    expect(() => buildMundialDraw(POTS, 1)).toThrow('groupCount');
    expect(() => buildMundialDraw([], 4)).toThrow('pots required');
    expect(() => buildMundialDraw([pot(1, ['abc'])], 2)).toThrow('invalid steamId');
  });
});

describe('/live/mundial routes', () => {
  let app, pool;
  beforeEach(() => {
    pool = { query: jest.fn(), connect: jest.fn() };
    setup(pool); app = express(); app.use(express.json()); app.use('/live', router);
  });

  test('GET returns the draw and knockout results keyed by slot', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ version: '3' }] })
      .mockResolvedValueOnce({ rows: [
        { key: 'draw', value: { groups: [] } },
        { key: 'ko:qf1', value: { winnerSteamId: '1' } },
      ] });
    const res = await request(app).get('/live/mundial?v=1');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.draw).toEqual({ groups: [] });
    expect(res.body.knockout).toEqual({ qf1: { winnerSteamId: '1' } });
    expect(typeof res.body.serverTime).toBe('number');
  });

  test('draw stores a reveal schedule and refuses a second draw', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO mundial_state')) return { rows: [{ key: 'draw' }] };
      return { rows: [{ version: '4' }] };
    });
    const res = await request(app).post('/live/mundial/draw').send({ pots: POTS, groupCount: 4, countdownMs: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.draw.steps).toHaveLength(19);
    expect(res.body.draw.revealStartsAt - res.body.draw.createdAt).toBe(5000);

    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO mundial_state')) return { rows: [] };
      return { rows: [{ version: '4' }] };
    });
    const again = await request(app).post('/live/mundial/draw').send({ pots: POTS, groupCount: 4 });
    expect(again.status).toBe(409);
  });

  test('draw validates pots before touching the database', async () => {
    const res = await request(app).post('/live/mundial/draw').send({ pots: [pot(1, ['10001', '10002', '10003'])], groupCount: 2 });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('knockout result must name one of the two players as winner', async () => {
    const res = await request(app).post('/live/mundial/knockout-set').send({ slot: 'qf1', player1SteamId: '1', player2SteamId: '2', winnerSteamId: '3' });
    expect(res.status).toBe(400);
    const badSlot = await request(app).post('/live/mundial/knockout-set').send({ slot: 'r16', player1SteamId: '1', player2SteamId: '2', winnerSteamId: '1' });
    expect(badSlot.status).toBe(400);
  });

  test('deleting a quarter-final also clears the rounds that depend on it', async () => {
    pool.query.mockResolvedValue({ rows: [{ version: '5' }] });
    const res = await request(app).post('/live/mundial/knockout-delete').send({ slot: 'qf3' });
    expect(res.status).toBe(200);
    const deleteCall = pool.query.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM mundial_state'));
    expect(deleteCall[1][0]).toEqual(['ko:qf3', 'ko:sf2', 'ko:final']);
  });
});

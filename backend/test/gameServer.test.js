const crypto = require('crypto');
const { validateMatch, sessionEmail, registerGameServer } = require('../gameServer');
const express = require('express');
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const secret = 'test-only-game-control-key';
function session(exp = Math.floor(Date.now() / 1000) + 60) {
  const h = Buffer.from('{}').toString('base64url');
  const b = Buffer.from(JSON.stringify({ email: 'admin@example.test', exp })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`;
}
function match(n) {
  const players = offset => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(76561198000000000n + BigInt(offset + i)), `Player ${i}`]));
  return { players_per_team: n, team1: { name: 'A', players: players(0) }, team2: { name: 'B', players: players(20) }, maplist: ['de_dust2'], map_sides: ['team2_ct'], cvars: { tv_enable: 0 }, simulation: true };
}
test('accepts ten-player rosters and strips caller control of recording/simulation', () => {
  const result = validateMatch(match(10));
  expect(result.players_per_team).toBe(10);
  expect(result.min_players_to_ready).toBe(0);
  expect(result.map_sides).toEqual(['team2_ct']);
  expect(result.cvars).toEqual({});
  expect(result.simulation).toBeUndefined();
});
test('rejects oversized, unequal, duplicate and command-injecting rosters', () => {
  expect(() => validateMatch(match(11))).toThrow();
  const unequal = match(6); unequal.team2.players = {}; expect(() => validateMatch(unequal)).toThrow();
  const duplicate = match(6); duplicate.team2.players = duplicate.team1.players; expect(() => validateMatch(duplicate)).toThrow();
  const injection = match(6); injection.team1.name = 'A;quit'; expect(() => validateMatch(injection)).toThrow();
});
test('verifies session signatures and rejects expiry/tampering', () => {
  expect(sessionEmail(session(), secret)).toBe('admin@example.test');
  expect(sessionEmail(session(1), secret)).toBeNull();
  expect(sessionEmail(session() + 'x', secret)).toBeNull();
});
test('match lookup is authenticated, persistent and repeatable; failed loading is not success', async () => {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  process.env.CS2_MATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-control-test-'));
  const app = express(); app.use(express.json());
  const rcon = { status: jest.fn().mockResolvedValue({ live: false }), startMatch: jest.fn().mockRejectedValue(new Error('ack timeout')) };
  registerGameServer(app, { pool: { query: jest.fn().mockResolvedValue({ rows: [{}] }) }, rcon, gcp: {} });
  await request(app).post('/start-match').send(match(6)).expect(401);
  const response = await request(app).post('/start-match').set('x-game-session', session()).send(match(6)).expect(502);
  const id = response.body.matchid;
  await request(app).get(`/get-match/${id}`).expect(403);
  const first = await request(app).get(`/get-match/${id}`).set('Authorization', `Bearer ${secret}`).expect(200);
  const second = await request(app).get(`/get-match/${id}`).set('Authorization', `Bearer ${secret}`).expect(200);
  expect(first.body).toEqual(second.body);
});

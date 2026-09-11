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

test('accepts the reported Overpass, Tuscan, Vertigo series without changing maps or sides', () => {
  const input = match(5);
  input.maplist = ['de_overpass', '3267671493', 'de_vertigo'];
  input.map_sides = ['team2_ct', 'team1_ct', 'team2_ct'];
  const result = validateMatch(input);
  expect(result.maplist).toEqual(input.maplist);
  expect(result.map_sides).toEqual(input.map_sides);
  expect(result.num_maps).toBe(3);
});

test('accepts every map offered by the team picker', () => {
  const maps = require('../../frontend-nextjs/public/data/maps.json');
  for (const { id } of maps) {
    const input = match(5);
    input.maplist = [id];
    expect(validateMatch(input).maplist).toEqual([id]);
  }
});

test.each(['3267671493;quit', 'de_dust2\nquit', 'de_dust2\n', '3267671493\n', 'workshop/3267671493/de_tuscan',
  'https://example.test/map', '0', '-1', '1.5', '123456789012345678901', '', 3267671493, null, {}])(
  'rejects malformed or non-string map selection %p', map => {
    const input = match(5);
    input.maplist = [map];
    expect(() => validateMatch(input)).toThrow('Invalid map selection');
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

test('start-match persists a mixed Workshop series and waits for game acknowledgment', async () => {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  process.env.CS2_MATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-workshop-test-'));
  const app = express(); app.use(express.json());
  const rcon = { status: jest.fn().mockResolvedValue({ live: false }),
    startMatch: jest.fn().mockImplementation(async id => ({ matchLoaded: true, matchId: id })) };
  registerGameServer(app, { pool: { query: jest.fn().mockResolvedValue({ rows: [{}] }) }, rcon, gcp: {} });
  const input = match(5);
  input.maplist = ['de_overpass', '3267671493', 'de_vertigo'];
  input.map_sides = ['team2_ct', 'team1_ct', 'team2_ct'];
  try {
    const response = await request(app).post('/start-match').set('x-game-session', session()).send(input).expect(200);
    const saved = await request(app).get(`/get-match/${response.body.matchid}`).set('Authorization', `Bearer ${secret}`).expect(200);
    expect(saved.body.maplist).toEqual(input.maplist);
    expect(saved.body.map_sides).toEqual(input.map_sides);
    expect(rcon.startMatch).toHaveBeenCalledWith(response.body.matchid);
    expect(response.body.status).toEqual({ matchLoaded: true, matchId: response.body.matchid });
  } finally {
    fs.rmSync(process.env.CS2_MATCH_DIR, { recursive: true, force: true });
  }
});

test.each(['live', 'preparing', 'recording', 'matchStarted'])('rejects map replacement while %s without saving or loading a match', async flag => {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-active-test-'));
  process.env.CS2_MATCH_DIR = directory;
  const app = express(); app.use(express.json());
  const rcon = { status: jest.fn().mockResolvedValue({ [flag]: true }), startMatch: jest.fn() };
  registerGameServer(app, { pool: { query: jest.fn().mockResolvedValue({ rows: [{}] }) }, rcon, gcp: {} });
  try {
    await request(app).post('/start-match').set('x-game-session', session()).send(match(5)).expect(409);
    expect(rcon.startMatch).not.toHaveBeenCalled();
    expect(fs.readdirSync(directory)).toEqual([]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('allows replacing a loaded warmup with a different map and roster', async () => {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-replace-test-'));
  process.env.CS2_MATCH_DIR = directory;
  const app = express(); app.use(express.json());
  const rcon = {
    status: jest.fn().mockResolvedValue({ matchLoaded: true, matchId: 123, warmup: true, live: false, recording: false, preparing: false, matchStarted: false }),
    startMatch: jest.fn().mockImplementation(async id => ({ matchLoaded: true, matchId: id, map: 'de_inferno' })),
  };
  registerGameServer(app, { pool: { query: jest.fn().mockResolvedValue({ rows: [{}] }) }, rcon, gcp: {} });
  const input = match(3); input.maplist = ['de_inferno'];
  try {
    const response = await request(app).post('/start-match').set('x-game-session', session()).send(input).expect(200);
    expect(rcon.startMatch).toHaveBeenCalledWith(response.body.matchid);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, response.body.matchid + '.json')));
    expect(saved.team1).toEqual(input.team1);
    expect(saved.team2).toEqual(input.team2);
    expect(saved.maplist).toEqual(['de_inferno']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

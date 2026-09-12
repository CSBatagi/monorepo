const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { catalog, emptyState, validateState, equipped } = require('../cosmetics');
const { registerCosmeticsRoutes } = require('../cosmeticsRoutes');
const secret = 'test-only-cosmetics-secret';
const find = kind => catalog.items.find(i => i.kind === kind);
function select(kind, team) {
  const item = find(kind);
  return { id: item.id, team: team || item.teams[0], wear: item.minWear, seed: 1, nametag: 'Batagi', stattrak: true, stickers: [find('sticker').id, null, null, null, null], charm: find('charm').id };
}
function state(items = [select('weapon')]) { return { active: 0, profiles: [{ name: 'Test', items }] }; }
function session(email = 'member@example.test', exp = Date.now() / 1000 + 60) {
  const header = Buffer.from('{}').toString('base64url');
  const body = Buffer.from(JSON.stringify({ uid: '76561198000000001', steamId: '76561198000000001', provider: 'steam', exp })).toString('base64url');
  return `${header}.${body}.${crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')}`;
}
function setup() {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const pool = { query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn() };
  const app = express(); app.use(express.json()); registerCosmeticsRoutes(app, { pool });
  const member = call => call.set('Authorization', `Bearer ${secret}`).set('x-game-session', session());
  const server = call => call.set('Authorization', `Bearer ${secret}`);
  return { pool, app, member, server };
}
test('catalog has distinct allowlisted categories and valid game IDs', () => {
  expect(find('knife').defindex).toBeGreaterThanOrEqual(500);
  expect(find('glove').defindex).toBeGreaterThan(4000);
  expect(catalog.items.every(i => Number.isInteger(i.defindex))).toBe(true);
});
test('validates full loadout and serializes the upstream v5 contract with distinct teams, stickers and charm slots', () => {
  const items = ['weapon', 'knife', 'glove', 'agent', 'music'].map(k => select(k));
  const data = equipped(validateState(state(items)));
  const weapon = data[items[0].team === 2 ? 'tWeapons' : 'ctWeapons'][find('weapon').defindex];
  expect(weapon.stickers).toEqual([{ slot: 0, def: find('sticker').defindex, wear: 0 }]);
  expect(weapon.keychains[0]).toEqual({ slot: 0, def: find('charm').defindex, seed: 1 });
  expect(data.knives[items[1].team].def).toBe(find('knife').defindex);
  expect(data.agents[items[3].team].def).toBe(find('agent').defindex);
  expect(data.musicKit).toMatchObject({ def: 1314, musicId: find('music').defindex });
  expect(weapon.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(equipped(emptyState())).toEqual({ agents: {}, ctWeapons: {}, gloves: {}, knives: {}, tWeapons: {} });
});
test.each([
  { id: 'unknown' }, { wear: -0.1 }, { wear: Infinity }, { seed: 1001 }, { seed: 0.5 }, { team: 1 },
  { nametag: 'bad\nname' }, { stickers: ['unknown', null, null, null, null] }, { charm: find('agent').id },
  { stattrak: 'true' }
])('rejects unsupported or malformed customization %j', patch => {
  expect(() => validateState(state([{ ...select('weapon'), ...patch }]))).toThrow();
});
test('rejects duplicate slots, wrong-team agents, oversized profiles and forged item attributes', () => {
  expect(() => validateState(state([select('weapon'), select('weapon')]))).toThrow();
  const agent = select('agent'); agent.team = agent.team === 2 ? 3 : 2;
  expect(() => validateState(state([agent]))).toThrow();
  expect(() => validateState({ active: 0, profiles: Array(4).fill(state().profiles[0]) })).toThrow();
  expect(validateState(state([{ ...select('weapon'), def: 1, paint: 999, hash: 'fake' }])).profiles[0].items[0].def).toBeUndefined();
});
test('requires both bearer and valid session for member routes; forged/expired sessions fail', async () => {
  const { app, pool, server } = setup();
  await request(app).get('/cosmetics/me').expect(403);
  await server(request(app).get('/cosmetics/me')).expect(401);
  await server(request(app).get('/cosmetics/me')).set('x-game-session', session() + 'tampered').expect(401);
  await server(request(app).get('/cosmetics/me')).set('x-game-session', session(undefined, 1)).expect(401);
  expect(pool.query).not.toHaveBeenCalled();
});
test('save resolves identity from session, strips payload identity and checks revision', async () => {
  const { app, pool, member } = setup();
  const client = { query: jest.fn(async sql => ({ rows: sql.startsWith('SELECT steam_id') ? [{ steam_id: '76561198000000001' }] : sql.startsWith('SELECT item_id') ? state().profiles[0].items.flatMap(i => [i.id, ...i.stickers, i.charm]).filter(Boolean).map(item_id => ({ item_id })) : sql.startsWith('UPDATE cosmetic_loadouts') ? [{ revision: 4 }] : [] })), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  await member(request(app).post('/cosmetics/save')).send({ email: 'victim@example.test', steamId: '76561198000000001', state: state(), revision: 3 }).expect(200);
  const update = client.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE cosmetic_loadouts'));
  expect(update[1][0]).toBe('76561198000000001');
  expect(update[1][2]).toBe(3);
  client.query.mockImplementation(async sql => ({ rows: sql.startsWith('SELECT steam_id') ? [{ steam_id: '76561198000000001' }] : sql.startsWith('SELECT item_id') ? state().profiles[0].items.flatMap(i => [i.id, ...i.stickers, i.charm]).filter(Boolean).map(item_id => ({ item_id })) : [] }));
  await member(request(app).post('/cosmetics/save')).send({ state: state(), revision: 3 }).expect(409);
});
test('catalog is paged and filters names/model without accepting untrusted definitions', async () => {
  const { app, member } = setup();
  const result = await member(request(app).get('/cosmetics/catalog?kind=sticker')).expect(200);
  expect(result.body.items).toHaveLength(48);
  expect(result.body.total).toBeGreaterThan(48);
  expect(result.headers['cache-control']).toBe('no-store');
});
test('old code linking is retired and cannot mutate account ownership', async () => {
  const { app, member, server, pool } = setup();
  await member(request(app).post('/cosmetics/link-code')).send({}).expect(404);
  await server(request(app).post('/cosmetics/server/link')).send({code:'ABCDEF1234567890',steamId:'76561198000000001'}).expect(410);
  expect(pool.query).not.toHaveBeenCalled();
});

test('game API requires bearer and returns a safe empty loadout for unlinked players', async () => {
  const { app, server } = setup();
  await request(app).get('/cosmetics/api/equipped/v5/76561198000000001.json').expect(403);
  const result = await server(request(app).get('/cosmetics/api/equipped/v5/76561198000000001.json')).expect(200);
  expect(result.body).toEqual(equipped(emptyState()));
  await server(request(app).get('/cosmetics/api/equipped/v5/not-a-steam-id.json')).expect(400);
});

// Run against a disposable local PostgreSQL database, never production:
// COSMETICS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres npm test ...
const { Pool } = require('pg');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { catalog, emptyState } = require('../cosmetics');
const { itemAccess } = require('../cosmeticProgression');
const { registerCosmeticsRoutes, COSMETICS_MIGRATIONS } = require('../cosmeticsRoutes');
const { resolveSeasonConfig } = require('../seasonConfig');
const connectionString = process.env.COSMETICS_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const secret = 'local-progression-test-secret';
const steamId = '76561198000000001';
const memberEmail = 'member@example.test';
const adminEmail = 'admin@example.test';
function session(email) {
  const h = Buffer.from('{}').toString('base64url');
  const b = Buffer.from(JSON.stringify({ email, exp: Date.now() / 1000 + 600 })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`;
}
suite('real PostgreSQL progression and authorization', () => {
  let pool, owner, app, schema;
  const call = (method, path, email = memberEmail) => request(app)[method](`/cosmetics/${path}`).set('Authorization', `Bearer ${secret}`).set('x-game-session', session(email));
  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(connectionString).hostname)) throw new Error('Disposable local PostgreSQL only');
    schema = `cosmetics_test_${crypto.randomBytes(6).toString('hex')}`;
    owner = new Pool({ connectionString, max: 1 });
    await owner.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema} -c timezone=UTC` });
    process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
    for (const sql of [
      'CREATE TABLE admins(email TEXT PRIMARY KEY,is_admin BOOLEAN)',
      'CREATE TABLE stats_refresh_state(id INTEGER PRIMARY KEY,dirty BOOLEAN)',
      'INSERT INTO stats_refresh_state VALUES(1,false)',
      'CREATE TABLE matches(checksum TEXT PRIMARY KEY,date TIMESTAMPTZ,winner_name TEXT)',
      'CREATE TABLE players(match_checksum TEXT,steam_id VARCHAR NOT NULL,team_name TEXT,hltv_rating_2 REAL,assist_count INTEGER)',
      'CREATE TABLE rounds(match_checksum TEXT,number INTEGER)',
      ...COSMETICS_MIGRATIONS,
    ]) await pool.query(sql);
    await pool.query("UPDATE cosmetic_economy SET starts_at=NOW()-INTERVAL '7 days'");
    await pool.query('INSERT INTO admins VALUES($1,true)', [adminEmail]);
    app = express(); app.use(express.json()); registerCosmeticsRoutes(app, { pool });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE cosmetic_premium_awards,cosmetic_unlocks,cosmetic_rewards,cosmetic_wallets,cosmetic_accounts,players,matches,rounds');
    await pool.query('UPDATE stats_refresh_state SET dirty=false');
    await pool.query('INSERT INTO cosmetic_accounts(email,steam_id,state) VALUES($1,$2,$3)', [memberEmail, steamId, JSON.stringify(emptyState())]);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (owner) { if (schema) await owner.query(`DROP SCHEMA ${schema} CASCADE`); await owner.end(); }
  });
  async function match(checksum, { days = 2, rounds = 24, rating = 1.3, assists = 5, win = true } = {}) {
    await pool.query("INSERT INTO matches VALUES($1,date_trunc('day',NOW())-($2 * INTERVAL '1 day')+INTERVAL '20 hours',$3)", [checksum, days, win ? 'A' : 'B']);
    await pool.query("INSERT INTO players VALUES($1,$2,'A',$3,$4)", [checksum, steamId, rating, assists]);
    await pool.query('INSERT INTO rounds SELECT $1,generate_series(1,$2::integer)', [checksum, rounds]);
  }
  test('starter allowance is once per Steam identity and reads are idempotent', async () => {
    const results = await Promise.all([call('get', 'me'), call('get', 'me')]);
    for (const r of results) { expect(r.status).toBe(200); expect(r.body.progress).toMatchObject({ tokens: 30, xp: 0, premiumTokens: 0 }); }
    await pool.query('UPDATE cosmetic_accounts SET email=$1 WHERE steam_id=$2', ['recovered@example.test', steamId]);
    expect((await call('get', 'me', 'recovered@example.test')).body.progress.tokens).toBe(30);
  });
  test('match and night rewards settle once across concurrent refresh, duplicate rows and reanalysis', async () => {
    await match('map-one'); await match('map-two', { rating: 0.5, assists: 5, win: false });
    await pool.query('INSERT INTO players SELECT * FROM players WHERE match_checksum=$1', ['map-one']);
    const results = await Promise.all([call('get', 'me'), call('get', 'me'), call('get', 'me')]);
    for (const r of results) { expect(r.status).toBe(200); expect(r.body.progress).toMatchObject({ tokens: 61, xp: 310, level: 2, matches: 2, nights: 1, premiumTokens: 0 }); }
    await pool.query('UPDATE players SET hltv_rating_2=2');
    expect((await call('get', 'me')).body.progress.tokens).toBe(61);
  });
  test('dirty imports, old matches and short warmups do not mint tokens; publish permits delayed credit', async () => {
    await match('valid'); await match('old', { days: 10 }); await match('warmup', { rounds: 5 });
    await pool.query('UPDATE stats_refresh_state SET dirty=true');
    expect((await call('get', 'me')).body.progress.tokens).toBe(30);
    await pool.query('UPDATE stats_refresh_state SET dirty=false');
    expect((await call('get', 'me')).body.progress).toMatchObject({ tokens: 49, matches: 1, nights: 1, xp: 190 });
  });
  test('night boundary uses 06:00 Istanbul and missed nights impose no penalty', async () => {
    await match('late'); await match('early'); await match('next-night');
    await pool.query("UPDATE matches SET date=date_trunc('day',NOW())-INTERVAL '2 days'+CASE checksum WHEN 'late' THEN INTERVAL '22 hours' WHEN 'early' THEN INTERVAL '26 hours' ELSE INTERVAL '27 hours' END");
    const r = await call('get', 'me');
    expect(r.status).toBe(200); expect(r.body.progress).toMatchObject({ matches: 3, nights: 2, tokens: 82, xp: 520 });
  });
  test('concurrent regular purchases cannot overspend, and buying an owned item is free', async () => {
    const items = catalog.items.filter(i => itemAccess(i).tier === 'club').slice(0, 2);
    const results = await Promise.all(items.map(item => call('post', 'unlock').send({ itemId: item.id, tokens: 9999, email: adminEmail })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const owned = results.find(r => r.status === 200).body.item;
    const replay = await call('post', 'unlock').send({ itemId: owned.id });
    expect(replay.status).toBe(200); expect(replay.body.progress.tokens).toBe(10);
    expect((await pool.query('SELECT * FROM cosmetic_unlocks')).rows).toHaveLength(1);
  });
  test('level gate and premium currency cannot be bypassed with regular wealth or client fields', async () => {
    await call('get', 'me');
    await pool.query('UPDATE cosmetic_wallets SET tokens=9999');
    const elite = catalog.items.find(i => itemAccess(i).tier === 'elite');
    const premium = catalog.items.find(i => itemAccess(i).tier === 'premium');
    expect((await call('post', 'unlock').send({ itemId: elite.id, level: 99 })).status).toBe(409);
    await pool.query('UPDATE cosmetic_wallets SET xp=9000');
    expect((await call('post', 'unlock').send({ itemId: premium.id, premiumTokens: 99 })).status).toBe(409);
    expect((await call('post', 'unlock').send({ itemId: elite.id })).status).toBe(200);
  });
  test('only current admins can award; retries mint once, changed replay fails, and premium spend is permanent', async () => {
    const award = { requestId: crypto.randomUUID(), steamId, amount: 1, reason: 'Sezon MVP', seasonStart: resolveSeasonConfig().seasonStart };
    expect((await call('post', 'award').send(award)).status).toBe(403);
    expect((await call('get', 'awards')).status).toBe(403);
    const results = await Promise.all([call('post', 'award', adminEmail).send(award), call('post', 'award', adminEmail).send(award)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect((await call('post', 'award', adminEmail).send({ ...award, amount: 2 })).status).toBe(409);
    const premium = catalog.items.find(i => itemAccess(i).tier === 'premium');
    const unlock = await call('post', 'unlock').send({ itemId: premium.id });
    expect(unlock.status).toBe(200); expect(unlock.body.progress).toMatchObject({ premiumTokens: 0, tokens: 30 });
    expect(unlock.body.progress.unlocks).toContain(premium.id);
    expect((await call('post', 'unlock').send({ itemId: premium.id })).status).toBe(200);
    const history = await call('get', 'awards', adminEmail);
    expect(history.body.awards).toHaveLength(1); expect(history.body.awards[0].admin_email).toBe(adminEmail);
    await pool.query('UPDATE admins SET is_admin=false');
    expect((await call('post', 'award', adminEmail).send({ ...award, requestId: crypto.randomUUID() })).status).toBe(403);
    await pool.query('UPDATE admins SET is_admin=true');
  });
  test('save and game output both exclude unowned premium items and attachments, including legacy sets', async () => {
    const weapon = catalog.items.find(i => i.kind === 'weapon' && itemAccess(i).cost === 0);
    const sticker = catalog.items.find(i => i.kind === 'sticker' && itemAccess(i).tier === 'premium');
    const state = { active: 0, profiles: [{ name: 'Test', items: [{ id: weapon.id, team: 2, wear: weapon.minWear, seed: 1, stattrak: false, nametag: '', stickers: [sticker.id, null, null, null, null], charm: null }] }] };
    expect((await call('post', 'save').send({ state, revision: 0 })).status).toBe(403);
    await pool.query('UPDATE cosmetic_accounts SET state=$1', [JSON.stringify(state)]);
    const legacy = await call('get', 'me');
    expect(legacy.body.removedLockedItems).toBe(true);
    const game = await call('get', `api/equipped/v5/${steamId}.json`);
    expect(game.body.tWeapons[weapon.defindex].stickers).toEqual([]);
    state.profiles[0].items[0].stickers[0] = null;
    expect((await call('post', 'save').send({ state, revision: 0 })).status).toBe(200);
    expect((await call('post', 'save').send({ state, revision: 0 })).status).toBe(409);
  });
});

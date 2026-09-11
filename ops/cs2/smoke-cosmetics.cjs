// Run inside the backend container after deployment. Uses only a temporary synthetic account.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('/app/node_modules/pg');
const { catalog } = require('/app/cosmetics');
const email = `cosmetics-smoke-${crypto.randomUUID()}@example.invalid`;
const steamId = '76561198000000001';
const secret = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
const header = Buffer.from('{}').toString('base64url');
const body = Buffer.from(JSON.stringify({ email, exp: Date.now() / 1000 + 300 })).toString('base64url');
const session = `${header}.${body}.${crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')}`;
const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, max: 1 });
async function call(url, payload, web = false, expected = 200) {
  const response = await fetch(url, { method: payload === undefined ? 'GET' : 'POST', headers: web ? { cookie: `csbatagi_session=${session}`, host: 'csbatagi.com', origin: 'https://csbatagi.com', 'Content-Type': 'application/json' } : { Authorization: `Bearer ${process.env.AUTH_TOKEN}`, 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  assert.equal(response.status, expected, `${url}: ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
async function main() {
  assert.equal((await pool.query('SELECT 1 FROM cosmetic_accounts WHERE steam_id=$1', [steamId])).rowCount, 0, 'Synthetic Steam ID is already assigned; refusing to touch it');
  const base = 'https://csbatagi.com/api/cosmetics/';
  try {
    assert.equal((await call(base + 'me', undefined, true)).steamId, null);
    const code = (await call(base + 'link-code', {}, true)).code;
    await call('http://localhost:3000/cosmetics/server/link', { code, steamId });
    await call('http://localhost:3000/cosmetics/server/link', { code, steamId }, false, 400);
    const account = await call(base + 'me', undefined, true);
    assert.equal(account.steamId, steamId);
    const find = kind => catalog.items.find(item => item.kind === kind);
    const items = ['weapon', 'knife', 'glove', 'agent', 'music'].map(kind => {
      const item = find(kind);
      return { id: item.id, team: item.teams[0], wear: item.minWear, seed: 321, nametag: 'Smoke test', stattrak: true, stickers: [find('sticker').id, null, null, null, null], charm: find('charm').id };
    });
    const state = { active: 0, profiles: [{ name: 'Smoke test', items }] };
    const saved = await call(base + 'save', { state, revision: account.revision }, true);
    assert.equal(saved.revision, account.revision + 1);
    await call(base + 'save', { state, revision: account.revision }, true, 409);
    const game = await call(`http://localhost:3000/cosmetics/api/equipped/v5/${steamId}.json`);
    const weapon = game[items[0].team === 2 ? 'tWeapons' : 'ctWeapons'][find('weapon').defindex];
    assert.equal(weapon.seed, 321);
    assert.equal(weapon.stickers.length, 1);
    assert.equal(weapon.keychains.length, 1);
    assert.equal(game.knives[items[1].team].def, find('knife').defindex);
    assert.equal(game.gloves[items[2].team].def, find('glove').defindex);
    assert.equal(game.agents[items[3].team].def, find('agent').defindex);
    assert.equal(game.musicKit.musicId, find('music').defindex);
    assert.ok((await call(base + 'me', undefined, true)).lastFetchedAt);
    assert.ok((await call(base + 'catalog?kind=knife&q=Doppler', undefined, true)).total > 0);
    const unauth = await fetch('http://localhost:3000/cosmetics/api/equipped/v5/' + steamId + '.json');
    assert.equal(unauth.status, 403);
    console.log('PASS: frontend session proxy, linking, replay rejection, catalog, persistent save, revision conflict, all equipment categories, authenticated game API.');
  } finally {
    await pool.query('DELETE FROM cosmetic_link_codes WHERE email=$1', [email]);
    await pool.query('DELETE FROM cosmetic_accounts WHERE email=$1', [email]);
    await pool.end();
    console.log('Synthetic test account and code removed.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

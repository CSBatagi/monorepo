// Run from /app in the deployed backend container. Never print credentials or sessions.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('/app/node_modules/pg');
const { rosterMember } = require('/app/steamAuth');
const Gcp = require('/app/gcp');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 1 });

(async () => {
  const rows = (await pool.query('SELECT steam_id,uid FROM steam_members')).rows;
  const member = rows.find(row => rosterMember(row.steam_id));
  assert(member, 'No member available for read-only API validation');
  const key = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ provider: 'steam', uid: member.uid, steamId: member.steam_id,
    exp: Math.floor(Date.now() / 1000) + 120 })).toString('base64url');
  const session = `${header}.${body}.${crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url')}`;
  const gcp = new Gcp();
  const connection = await gcp.getConnectionInfo();
  await gcp.compute.close();
  const fetchOptions = headers => ({ headers, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  for (const [url, headers] of [
    ['http://127.0.0.1:3000/game-status', { Authorization: `Bearer ${process.env.AUTH_TOKEN}`, 'X-Game-Session': session }],
    ['https://csbatagi.com/api/game-status', { Cookie: `csbatagi_session=${session}` }],
  ]) {
    const response = await fetch(url, fetchOptions(headers));
    const status = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (connection.status === 'TERMINATED') {
      assert.equal(response.status, 503);
      assert(!status.connection?.address);
    } else {
      assert.equal(response.status, 200);
      if (status.serverReady !== false) {
        assert(status.connection.address);
        assert.equal(status.connection.directAddress || status.connection.address, connection.address);
      }
    }
    console.log(JSON.stringify({ check: url, http: response.status, serverReady: status.serverReady,
      transport: status.connection?.transport || null, address: status.connection?.address || null }));
  }
  for (const page of ['team-picker', 'ekipman']) {
    const response = await fetch(`https://csbatagi.com/${page}`, fetchOptions({ Cookie: `csbatagi_session=${session}` }));
    assert.equal(response.status, 200);
    const html = await response.text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(match => match[1]))];
    assert(assets.length > 0, 'No static assets found');
    // Serial asset checks keep the small production VM's load bounded.
    for (const asset of assets) {
      const loaded = await fetch(new URL(asset, 'https://csbatagi.com'), fetchOptions({}));
      assert.equal(loaded.status, 200);
      await loaded.arrayBuffer();
    }
    console.log(JSON.stringify({ page, http: 200, assets: assets.length }));
  }
  const diagnostics = await fetch('http://127.0.0.1:3000/stats/diagnostics', fetchOptions({}));
  assert.equal(diagnostics.status, 200);
  const data = await diagnostics.json();
  console.log(JSON.stringify({ statsDiagnostics: diagnostics.status, counts: data.counts }));
})().catch(() => { console.error('Connection website validation failed; no private diagnostics printed.'); process.exitCode = 1; })
  .finally(() => pool.end());

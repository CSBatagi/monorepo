// Run only inside the production backend. Nothing secret is printed. It uses
// short-lived synthetic sessions for existing members; no account/role is made.
const crypto = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { Pool } = require('/app/node_modules/pg');
const { connectQuery } = require('/app/teamSpeakQuery');
const { configFromEnv, verifyConfiguration } = require('/app/teamSpeak');
const origin = 'https://csbatagi.com';
const checks = [];
function passed(name) { checks.push(name); }
function signed(member, overrides = {}) {
  const header = Buffer.from('{}').toString('base64url');
  const body = Buffer.from(JSON.stringify({ uid: member.uid, steamId: member.steam_id, provider: 'steam', exp: Date.now() / 1000 + 60, ...overrides })).toString('base64url');
  return header + '.' + body + '.' + crypto.createHmac('sha256', process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN).update(header + '.' + body).digest('base64url');
}
async function web(action, body, session, requestOrigin = origin) {
  const headers = { Origin: requestOrigin, 'Content-Type': 'application/json' };
  if (session) headers.Cookie = 'csbatagi_session=' + session;
  return fetch(origin + '/api/teamspeak/' + action, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'manual' });
}
async function main() {
  const config = configFromEnv();
  assert.notEqual(config.queryUser, 'serveradmin');
  const query = await connectQuery(config);
  try {
    await verifyConfiguration(query, config); passed('live guest/member/channel isolation');
    const permissionId = (await query.command('permissionlist')).find(p => p.permname === 'i_client_talk_power')?.permid;
    assert.ok(permissionId);
    await assert.rejects(() => query.command('servergroupaddperm', { sgid: config.groupId, permid: permissionId, permvalue: 50, permnegated: 0, permskip: 0 }));
    passed('website query cannot modify permissions');
    // A server edit with an unchanged name is harmless even if a policy mistake
    // exists, and must be denied to this limited query account.
    const server = (await query.command('serverinfo'))[0];
    await assert.rejects(() => query.command('serveredit', { virtualserver_name: server.virtualserver_name }));
    passed('website query cannot edit the server');
    await assert.rejects(() => query.command('tokenlist'));
    passed('website query cannot read privilege keys');
  } finally { query.close(); }
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT || 5432, database: process.env.DB_DATABASE,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 1 });
  try {
    const players = JSON.parse(fs.readFileSync(process.env.PLAYERS_FILE || '/app/players.json', 'utf8'));
    const ids = new Set(players.map(p => p.steamId));
    const rows = (await pool.query('SELECT uid,steam_id FROM steam_members ORDER BY is_admin ASC,last_login_at DESC LIMIT 100')).rows;
    const member = rows.find(row => ids.has(row.steam_id));
    assert.ok(member); passed('existing Steam member read without account changes');
    const deviceId = crypto.randomUUID();
    const session = signed(member);
    for (const action of ['join', 'status', 'verify']) {
      const body = { deviceId, requestId: crypto.randomUUID(), code: '0000000000' };
      assert.equal((await web(action, body)).status, 401); passed(action + ': signed-out request rejected');
      assert.equal((await web(action, body, session + 'tampered')).status, 401); passed(action + ': forged session rejected');
      assert.equal((await web(action, body, signed(member, { provider: 'google' }))).status, 401); passed(action + ': non-Steam session rejected');
      assert.equal((await web(action, body, session, 'https://foreign.example')).status, 403); passed(action + ': foreign origin rejected');
    }
    const response = await web('join', { deviceId }, session);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    const url = new URL(data.url);
    assert.equal(url.hostname, 'voice.csbatagi.com'); assert.equal(url.protocol, 'ts3server:');
    assert.deepEqual(Object.keys(data).sort(), ['expiresAt', 'requestId', 'state', 'url']);
    assert.ok(!url.searchParams.has('token') && !url.searchParams.has('password'));
    assert.ok(!JSON.stringify(data).includes(config.queryPassword));
    passed('authenticated preparation returns only a key-free connection');
    assert.equal(data.state, 'waiting');
    const premature = await web('verify', { deviceId, requestId: data.requestId, code: '0000000000' }, session);
    assert.equal(premature.status, 409); passed('proof is required before membership assignment');
    const denied = await fetch('http://127.0.0.1:3000/teamspeak/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId }) });
    assert.equal(denied.status, 403); passed('direct backend access needs its internal credential');
    const diagnostics = await fetch('http://127.0.0.1:3000/stats/diagnostics').then(r => r.json());
    assert.ok(Number(diagnostics.counts?.sonmac_dates || diagnostics.counts?.sonmac_all_dates) > 0);
    assert.ok(Number(diagnostics.counts?.night_avg_dates || diagnostics.counts?.night_avg_all_dates) > 0);
    passed('production stats remain populated');
    console.log(JSON.stringify({ live_checks_passed: checks.length, checks, real_desktop_join: 'requires account-owner test' }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(JSON.stringify({ live_validation_failed: true, completed_checks: checks, query_code: /^\d+$/.test(error.code || '') ? error.code : null, failed_permission: error.failedPermission || null, command: /^[a-z]+$/.test(error.commandName || '') ? error.commandName : null, credentials_logged: false })); process.exitCode = 1; });

// Execute inside the existing backend; print neither credentials nor sessions.
const crypto = require('node:crypto');
const { Pool } = require('/app/node_modules/pg');
const Gcp = require('/app/gcp');
const Rcon = require('/app/rcon');
const { rosterMember } = require('/app/steamAuth');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 1,
  connectionTimeoutMillis: 5000, query_timeout: 5000 });

(async () => {
  if (process.argv[2] === 'tunnel') {
    process.env.CS2_RCON_HOST = 'cs2-rcon-tunnel';
    const status = await new Rcon().status();
    if (status.serverReady !== true) throw new Error('not_ready');
    console.log(JSON.stringify({ tunnelRcon: 'passed', serverReady: true, humans: status.humans,
      live: status.live, recording: status.recording }));
    return;
  }
  const cloud = new Gcp();
  let connection;
  try {
    connection = await cloud.getConnectionInfo();
    console.log(JSON.stringify({ cloudStatus: connection.status, discoveredPrivateHost: !!connection.privateHost,
      rconOverride: process.env.CS2_RCON_HOST || null }));
  } finally { await cloud.compute.close(); }
  const member = (await pool.query('SELECT steam_id,uid FROM steam_members')).rows.find(row => rosterMember(row.steam_id));
  if (!member) throw new Error('no_member');
  const key = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ provider: 'steam', uid: member.uid,
    steamId: member.steam_id, exp: Math.floor(Date.now() / 1000) + 120 })).toString('base64url');
  const session = `${header}.${body}.${crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url')}`;
  let failed = false;
  for (const [url, headers] of [
    ['http://127.0.0.1:3000/game-status', { Authorization: `Bearer ${process.env.AUTH_TOKEN}`, 'X-Game-Session': session }],
    ['https://csbatagi.com/api/game-status', { Cookie: `csbatagi_session=${session}` }],
  ]) {
    const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const status = await response.json();
    const currentAddress = status.connection?.directAddress || status.connection?.address;
    const ready = response.status === 200 && status.serverReady === true && !!status.connection?.address
      && currentAddress === connection.address && response.headers.get('cache-control') === 'no-store';
    console.log(JSON.stringify({ check: url, http: response.status, serverReady: status.serverReady,
      address: status.connection?.address || null, transport: status.connection?.transport || null,
      updateStage: status.update?.stage || null, matchesCloudAddress: currentAddress === connection.address,
      noStore: response.headers.get('cache-control') === 'no-store' }));
    if (!ready) failed = true;
  }
  if (failed && process.argv[2] !== 'audit') process.exitCode = 1;
})().catch(error => {
  console.error(JSON.stringify({ controlProbeFailed: true,
    failure: error.message === 'Game server RCON timed out' ? 'rcon_timeout'
      : error.message === 'Game server RCON failed' ? 'rcon_connection_failed' : error.name,
    code: /^(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|no_member|not_ready)$/.test(error.code || error.message)
      ? error.code || error.message : 'unavailable' }));
  process.exitCode = 1;
}).finally(() => pool.end());

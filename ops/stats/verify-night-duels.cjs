// Production smoke check, run inside the backend. Never prints credentials or sessions.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Pool } = require('/app/node_modules/pg');

async function main() {
  const deadline = Date.now() + 420000;
  let stats;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3000/stats/incremental?lastKnownVersion=0', { signal: AbortSignal.timeout(120000) });
      stats = await response.json();
      if (response.ok && Object.keys(stats.sonmac_by_date || {}).length && !stats.__errors?.length) break;
    } catch {}
    stats = null;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert(stats?.sonmac_by_date, 'Stats did not warm up');
  const token = process.env.AUTH_TOKEN || process.env.MATCHMAKING_TOKEN;
  assert(token, 'Missing internal authentication');
  // A schema addition needs a new published version even when source rows did not change.
  const regenerated = await fetch('http://127.0.0.1:3000/stats/force-regenerate', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180000),
  });
  assert(regenerated.ok, 'Release stats publish failed');
  stats = await regenerated.json();
  assert(!stats.__errors?.length, 'Stats generation reported query errors');
  const dates = Object.keys(stats.sonmac_by_date).sort();
  const maps = Object.values(stats.sonmac_by_date).flatMap(night => Object.values(night.maps));
  assert(maps.length && maps.every(map => map.match_checksum && map.duels?.players.length), 'Missing duel data');

  // Compare every published current-season directed pair to independent source SQL.
  const pool = new Pool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE, max: 1, options: '-c default_transaction_read_only=on' });
  try {
    const { rows } = await pool.query(`SELECT k.match_checksum, k.killer_steam_id, k.victim_steam_id, COUNT(*) AS kills
      FROM kills k JOIN demos d ON d.checksum = k.match_checksum WHERE d.date::date >= $1::date
      GROUP BY k.match_checksum, k.killer_steam_id, k.victim_steam_id`, [dates[0]]);
    const expected = new Map(maps.map(map => [map.match_checksum, {}]));
    const rosters = new Map(maps.map(map => [map.match_checksum, new Set(map.duels.players.map(p => p.steam_id))]));
    for (const row of rows) {
      const roster = rosters.get(row.match_checksum);
      if (!roster || row.killer_steam_id === row.victim_steam_id || !roster.has(row.killer_steam_id) || !roster.has(row.victim_steam_id)) continue;
      const counts = expected.get(row.match_checksum);
      counts[row.killer_steam_id] ||= {};
      counts[row.killer_steam_id][row.victim_steam_id] = Number(row.kills);
    }
    for (const map of maps) assert.deepEqual(map.duels.kills, expected.get(map.match_checksum), 'Published duel counts differ from source');
  } finally { await pool.end(); }

  const prewarm = await fetch('http://frontend-nextjs:3000/api/internal/stats/prewarm', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000),
  });
  assert(prewarm.ok, 'Frontend prewarm failed');
  const published = await fetch('http://frontend-nextjs:3000/api/stats/check?lastKnownVersion=0&keys=sonmac_by_date_periods', { signal: AbortSignal.timeout(60000) }).then(r => r.json());
  assert.equal(published.statsVersion, stats.statsVersion, 'Frontend snapshot version mismatch');
  assert.deepEqual(published.sonmac_by_date_periods, stats.sonmac_by_date_periods, 'Frontend snapshot differs');

  const steamId = maps[0].duels.players.find(p => /^7656119\d{10}$/.test(p.steam_id))?.steam_id;
  assert(steamId, 'Missing member identity for page smoke check');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ uid: steamId, steamId, provider: 'steam', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const unsigned = `${header}.${body}`;
  const session = `${unsigned}.${createHmac('sha256', token).update(unsigned).digest('base64url')}`;
  const response = await fetch('http://frontend-nextjs:3000/gece-ortalama?gorunum=duello', {
    headers: { Cookie: `csbatagi_session=${session}` }, redirect: 'manual', signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, 200, 'Night page failed');
  const html = await response.text();
  // The search-parameter view hydrates in the browser; SSR supplies its data and assets.
  assert(html.includes('nightPayload') && html.includes('match_checksum'), 'Night page data missing');
  const scripts = [...html.matchAll(/<script[^>]+src="([^\"]+)"/g)].map(match => match[1]);
  assert(scripts.length, 'Night page assets missing');
  for (const script of scripts) {
    const asset = await fetch(new URL(script, 'http://frontend-nextjs:3000'), { signal: AbortSignal.timeout(15000) });
    assert(asset.ok, 'Night page asset failed');
    await asset.arrayBuffer();
  }
  const season = await fetch('http://frontend-nextjs:3000/duello', { headers: { Cookie: `csbatagi_session=${session}` }, redirect: 'manual' });
  assert.equal(season.status, 200, 'Season page failed');
  assert((await season.text()).includes('Sezon Düelloları'), 'Season page heading missing');
  console.log(JSON.stringify({ verified: true, currentSeasonNights: dates.length, matches: maps.length,
    latestNight: dates.at(-1), statsVersion: stats.statsVersion, sourceCountsMatch: true, snapshotMatches: true, pagesServed: true, assetsLoaded: scripts.length }));
}
main().catch(error => { console.error(JSON.stringify({ verified: false, reason: error.message.split('\n')[0] })); process.exitCode = 1; });

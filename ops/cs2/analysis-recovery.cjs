// Run inside the production backend. Credentials and signed sessions stay here.
const crypto = require('node:crypto');
const { Pool } = require('/app/node_modules/pg');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 1,
  connectionTimeoutMillis: 5000, query_timeout: 10000 });
const targets = [
  '2026-10-16_19-44-07_744392731_de_ancient_Team_Nerull_vs_Team_daE_d70ccf85.dem',
  '2026-10-16_20-39-25_744392731_de_breach_Team_Nerull_vs_Team_daE_ac8558d7.dem',
  '2026-10-16_21-31-00_744392731_de_cbble_d_Team_Nerull_vs_Team_daE_0ca30c87.dem',
];
(async () => {
  const mode = process.argv[2] || 'audit';
  if (!['audit', 'retry', 'verify'].includes(mode)) throw new Error('invalid_mode');
  const role = (await pool.query("SELECT rolcanlogin,rolsuper FROM pg_roles WHERE rolname='csdm_analyzer'")).rows[0];
  console.log(JSON.stringify({ analyzerRole: !!role, analyzerCanLogin: role?.rolcanlogin, analyzerSuperuser: role?.rolsuper,
    schemaVersion: (await pool.query('SELECT max(schema_version) AS version FROM migrations')).rows[0]?.version }));
  if (mode === 'retry') {
    const member = (await pool.query('SELECT steam_id,uid FROM steam_members WHERE is_admin=true ORDER BY created_at LIMIT 1')).rows[0];
    if (!member) throw new Error('no_admin');
    const key = process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ provider: 'steam', uid: member.uid, steamId: member.steam_id,
      exp: Math.floor(Date.now() / 1000) + 120 })).toString('base64url');
    const session = `${header}.${body}.${crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url')}`;
    for (const name of targets) {
      const row = (await pool.query('SELECT analysis_state,checksum FROM demo_files WHERE name=$1', [name])).rows[0];
      // Never force re-analysis of published stats or interrupt an active job.
      if (!row || row.checksum || ['queued', 'analyzing', 'analyzed'].includes(row.analysis_state)) continue;
      const response = await fetch(`http://127.0.0.1:3000/demos/${encodeURIComponent(name)}/analyze`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.AUTH_TOKEN}`, 'X-Game-Session': session,
          'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
      console.log(JSON.stringify({ retried: name, http: response.status }));
      if (!response.ok) throw new Error('retry_failed');
    }
  }
  const rows = (await pool.query(`SELECT f.name,f.map_name,f.archive_state,f.analysis_state,f.analysis_error,
    m.checksum IS NOT NULL AS linked, d.map_name AS match_map, m.analyze_date,
    (SELECT count(*)::int FROM rounds r WHERE r.match_checksum=m.checksum) AS rounds
    FROM demo_files f LEFT JOIN matches m ON m.checksum=f.checksum LEFT JOIN demos d ON d.checksum=m.checksum
    WHERE f.name=ANY($1::text[]) ORDER BY f.recorded_at`, [targets])).rows;
  for (const row of rows) console.log(JSON.stringify({ demo: row.name, map: row.map_name, archive: row.archive_state,
    analysis: row.analysis_state, linkedMatch: row.linked, matchMap: row.match_map, rounds: row.rounds,
    errorKind: row.analysis_error ? /Connection|connect|timeout/i.test(row.analysis_error) ? 'database_connection' : 'other' : null }));
  const response = await fetch('http://127.0.0.1:3000/stats/diagnostics', { signal: AbortSignal.timeout(20000) });
  const stats = await response.json();
  console.log(JSON.stringify({ statsHttp: response.status, statsState: stats.effectiveStatsState, counts: stats.counts }));
  if (mode === 'verify' && (rows.length !== targets.length || rows.some(row => row.analysis_state !== 'analyzed' || !row.linked || row.rounds < 1))) {
    throw new Error('recovery_incomplete');
  }
})().catch(error => {
  console.error(JSON.stringify({ analysisOperationFailed: true, code: /^(invalid_mode|no_admin|retry_failed|recovery_incomplete)$/.test(error.message)
    ? error.message : error.code && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : 'unavailable' }));
  process.exitCode = 1;
}).finally(() => pool.end());

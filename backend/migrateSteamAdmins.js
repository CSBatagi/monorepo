// One-time, operator-supplied migration of existing admin roles. Dry-run by default.
const fs = require('fs');
const path = require('path');
const { STEAM_AUTH_MIGRATIONS } = require('./steamAuth');

async function migrateSteamAdmins(pool, mappings, roster, apply = false) {
  if (!Array.isArray(mappings) || mappings.length === 0) throw new Error('An explicit admin mapping is required');
  const emails = new Set(), ids = new Set();
  for (const entry of mappings) {
    if (typeof entry.email !== 'string' || !entry.email.includes('@') || !roster.some(p => p.steamId === entry.steamId) || emails.has(entry.email) || ids.has(entry.steamId) || (entry.legacyUid !== undefined && (typeof entry.legacyUid !== 'string' || !entry.legacyUid))) throw new Error('Invalid or duplicate admin mapping');
    emails.add(entry.email); ids.add(entry.steamId);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of STEAM_AUTH_MIGRATIONS) await client.query(sql);
    const result = [];
    for (const entry of mappings) {
      if (!(await client.query('SELECT 1 FROM admins WHERE email=$1 AND is_admin=true FOR UPDATE', [entry.email])).rows.length) throw new Error('Mapping contains an account that is not a current admin');
      const linked = (await client.query('SELECT steam_id FROM cosmetic_accounts WHERE email=$1', [entry.email])).rows[0];
      if (linked?.steam_id && linked.steam_id !== entry.steamId) throw new Error('Existing equipment link conflicts with admin mapping');
      const current = (await client.query('SELECT * FROM steam_members WHERE steam_id=$1 OR legacy_email=$2 FOR UPDATE', [entry.steamId, entry.email])).rows;
      if (current.some(row => row.steam_id !== entry.steamId || (row.legacy_email && row.legacy_email !== entry.email) || (entry.legacyUid && row.uid !== entry.legacyUid))) throw new Error('Existing Steam member conflicts with admin mapping');
      await client.query(`INSERT INTO steam_members(steam_id,uid,display_name,legacy_email,is_admin) VALUES($1,$2,$3,$4,true) ON CONFLICT(steam_id) DO UPDATE SET legacy_email=EXCLUDED.legacy_email,is_admin=true`, [entry.steamId, entry.legacyUid || entry.steamId, roster.find(p => p.steamId === entry.steamId).name, entry.email]);
      result.push({ steamId: entry.steamId, name: roster.find(p => p.steamId === entry.steamId).name, applied: apply });
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

if (require.main === module) {
  require('dotenv').config({quiet:true});
  const { Pool } = require('pg');
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('Usage: node migrateSteamAdmins.js <private-mapping.json> [--apply]');
  const rosterFile = process.env.PLAYERS_FILE || path.join(__dirname, '../frontend-nextjs/public/data/players.json');
  const pool = new Pool({ host:process.env.DB_HOST, port:Number(process.env.DB_PORT||5432), user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_DATABASE, max:1 });
  migrateSteamAdmins(pool, JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')), JSON.parse(fs.readFileSync(rosterFile,'utf8')), process.argv.includes('--apply'))
    .then(result => console.log(JSON.stringify(result,null,2)))
    .catch(error => { console.error(error.code || error.message); process.exitCode=1; })
    .finally(() => pool.end());
}
module.exports = { migrateSteamAdmins };

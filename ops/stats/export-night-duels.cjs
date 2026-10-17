// Run in a private backend-container staging directory. Export only public stats.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('/app/node_modules/pg');
const { resolveSeasonConfig } = require('/app/seasonConfig');
const { generateHistoricalDateKeyedAllTime } = require('./statsGenerator');

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE, port: 5432, max: 1,
    options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 15000,
  });
  try {
    const config = resolveSeasonConfig();
    const result = await generateHistoricalDateKeyedAllTime(pool, config);
    const nights = result.sonmac_by_date_all;
    const maps = Object.values(nights).flatMap(night => Object.values(night.maps));
    if (!maps.length || maps.some(map => !map.match_checksum || !map.duels?.players.length)) throw new Error('Incomplete match duel export');
    const output = path.join(__dirname, 'sonmac_by_date_all.json');
    fs.writeFileSync(output, JSON.stringify(nights));
    console.log(JSON.stringify({ dates: Object.keys(nights).length, matches: maps.length, bytes: fs.statSync(output).size }));
  } finally {
    await pool.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

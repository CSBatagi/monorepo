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
    fs.writeFileSync(path.join(__dirname, 'night_avg_all.json'), JSON.stringify(result.night_avg_all));
    const nights = result.sonmac_by_date_all;
    const maps = Object.values(nights).flatMap(night => Object.values(night.maps));
    if (!maps.length || maps.some(map => !map.match_checksum || !map.duels?.players.length)) throw new Error('Incomplete match duel export');
    const counts = (await pool.query(`SELECT k.match_checksum, k.killer_steam_id, k.victim_steam_id, COUNT(*) AS kills
      FROM kills k JOIN demos d ON d.checksum = k.match_checksum GROUP BY k.match_checksum, k.killer_steam_id, k.victim_steam_id`)).rows;
    const byMatch = new Map();
    for (const row of counts) {
      if (!byMatch.has(row.match_checksum)) byMatch.set(row.match_checksum, []);
      byMatch.get(row.match_checksum).push(row);
    }
    const differences = [];
    for (const map of maps) {
      const roster = new Set(map.duels.players.map(p => p.steam_id));
      const expected = {};
      for (const row of byMatch.get(map.match_checksum) || []) {
        const killer = String(row.killer_steam_id), victim = String(row.victim_steam_id);
        if (killer === victim || !roster.has(killer) || !roster.has(victim)) continue;
        expected[killer] ||= {};
        expected[killer][victim] = Number(row.kills);
      }
      for (const killer of new Set([...Object.keys(expected), ...Object.keys(map.duels.kills)])) {
        for (const victim of new Set([...Object.keys(expected[killer] || {}), ...Object.keys(map.duels.kills[killer] || {})])) {
          if (expected[killer]?.[victim] !== map.duels.kills[killer]?.[victim]) differences.push({ checksum: map.match_checksum, map: map.map_name,
            expected: expected[killer]?.[victim], actual: map.duels.kills[killer]?.[victim] });
        }
      }
    }
    const report = { sourceMismatches: differences.length, samples: differences.slice(0, 3), sourceIdTypes: [...new Set(counts.map(r => typeof r.killer_steam_id))] };
    fs.writeFileSync(path.join(__dirname, 'duel-source-audit.json'), JSON.stringify(report));
    console.log(JSON.stringify(report));
    const output = path.join(__dirname, 'sonmac_by_date_all.json');
    fs.writeFileSync(output, JSON.stringify(nights));
    console.log(JSON.stringify({ dates: Object.keys(nights).length, matches: maps.length, bytes: fs.statSync(output).size }));
  } finally {
    await pool.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

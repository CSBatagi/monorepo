const { progressView } = require('./cosmeticProgression');

const PROGRESSION_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cosmetic_economy (id INTEGER PRIMARY KEY CHECK(id=1), starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `INSERT INTO cosmetic_economy(id) VALUES(1) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS cosmetic_wallets (steam_id TEXT PRIMARY KEY, xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0), tokens INTEGER NOT NULL DEFAULT 30 CHECK(tokens>=0), premium_tokens INTEGER NOT NULL DEFAULT 0 CHECK(premium_tokens>=0), matches INTEGER NOT NULL DEFAULT 0, nights INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS cosmetic_rewards (steam_id TEXT NOT NULL REFERENCES cosmetic_wallets(steam_id), event_key TEXT NOT NULL, kind TEXT NOT NULL, tokens INTEGER NOT NULL, xp INTEGER NOT NULL, earned_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(steam_id,event_key))`,
  `CREATE TABLE IF NOT EXISTS cosmetic_unlocks (steam_id TEXT NOT NULL REFERENCES cosmetic_wallets(steam_id), item_id TEXT NOT NULL, currency TEXT NOT NULL, cost INTEGER NOT NULL, unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(steam_id,item_id))`,
  `CREATE TABLE IF NOT EXISTS cosmetic_premium_awards (request_id UUID PRIMARY KEY, steam_id TEXT NOT NULL REFERENCES cosmetic_wallets(steam_id), admin_email TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 10), reason TEXT NOT NULL, season_start DATE NOT NULL, awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];

async function transaction(pool, callback) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function lockWallet(client, steamId) {
  await client.query('INSERT INTO cosmetic_wallets(steam_id) VALUES($1) ON CONFLICT DO NOTHING', [steamId]);
  const { rows } = await client.query('SELECT * FROM cosmetic_wallets WHERE steam_id=$1 FOR UPDATE', [steamId]);
  return rows[0];
}
async function unlocksFor(client, steamId) {
  const { rows } = await client.query('SELECT item_id FROM cosmetic_unlocks WHERE steam_id=$1', [steamId]);
  return new Set(rows.map(row => row.item_id));
}

// One statement sees source rows and the stats dirty flag in the same snapshot.
// Imported/reanalysed maps are credited once by checksum, regardless of requests,
// linked email changes, tab races or season rollover. Only published, substantive
// maps count; bots/spectators without a players row cannot claim a reward.
const REWARD_SQL = `WITH eligible AS (
  SELECT m.checksum, d.date, ((d.date AT TIME ZONE 'Europe/Istanbul') - INTERVAL '6 hours')::date AS night,
    BOOL_OR(m.winner_name = p.team_name) AS won,
    BOOL_OR(p.hltv_rating_2 >= 1.2 OR p.assist_count >= 5) AS performance
  FROM players p JOIN matches m ON m.checksum=p.match_checksum JOIN demos d ON d.checksum=m.checksum
  WHERE p.steam_id=$1 AND d.date >= (SELECT starts_at FROM cosmetic_economy WHERE id=1)
    AND d.date <= NOW() AND EXISTS (SELECT 1 FROM stats_refresh_state WHERE id=1 AND dirty=false)
    AND (SELECT COUNT(*) FROM rounds r WHERE r.match_checksum=m.checksum) >= 12
  GROUP BY m.checksum, d.date
), events AS (
  SELECT 'match:' || checksum AS event_key, 'match' AS kind,
    10 + CASE WHEN won THEN 2 ELSE 0 END + CASE WHEN performance THEN 2 ELSE 0 END AS tokens,
    100 + CASE WHEN won THEN 20 ELSE 0 END + CASE WHEN performance THEN 20 ELSE 0 END AS xp, date AS earned_at
  FROM eligible
  UNION ALL
  SELECT 'night:' || night::text, 'night', 5, 50, MIN(date) FROM eligible GROUP BY night
), inserted AS (
  INSERT INTO cosmetic_rewards(steam_id,event_key,kind,tokens,xp,earned_at)
  SELECT $1,event_key,kind,tokens,xp,earned_at FROM events ON CONFLICT DO NOTHING
  RETURNING tokens,xp,kind
)
UPDATE cosmetic_wallets SET tokens=tokens+COALESCE((SELECT SUM(tokens) FROM inserted),0),
  xp=xp+COALESCE((SELECT SUM(xp) FROM inserted),0),
  matches=matches+(SELECT COUNT(*) FROM inserted WHERE kind='match'),
  nights=nights+(SELECT COUNT(*) FROM inserted WHERE kind='night')
WHERE steam_id=$1 RETURNING *`;

async function syncRewards(client, steamId) {
  await lockWallet(client, steamId);
  const { rows } = await client.query(REWARD_SQL, [steamId]);
  return rows[0];
}
async function walletView(client, steamId, wallet) {
  return progressView(wallet, await unlocksFor(client, steamId));
}
module.exports = { PROGRESSION_MIGRATIONS, transaction, lockWallet, unlocksFor, syncRewards, walletView, REWARD_SQL };

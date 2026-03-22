#!/usr/bin/env node
/**
 * One-time migration: copy Batak AllStars data from Firebase RTDB to PostgreSQL.
 *
 * Migrates:
 *   - batakAllStars/captainsByDate → batak_captains
 *   - batakAllStars/superKupa → batak_super_kupa
 *   - admins → admins
 *
 * Usage:
 *   node scripts/migrate-batak-allstars.js
 *
 * Requires:
 *   - Firebase Admin env vars (FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON, FIREBASE_DATABASE_URL)
 *   - PostgreSQL env vars (DB_USER, DB_HOST, DB_DATABASE, DB_PASSWORD)
 *
 * Idempotent: uses ON CONFLICT DO NOTHING, safe to re-run.
 */

const { Pool } = require('pg');
const { adminDb } = require('../firebaseAdmin');

async function main() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: 5432,
  });

  console.log('[migrate-batak-allstars] Reading from Firebase RTDB...');

  const db = adminDb();
  const [captainsSnap, superKupaSnap, adminsSnap] = await Promise.all([
    db.ref('batakAllStars/captainsByDate').get(),
    db.ref('batakAllStars/superKupa').get(),
    db.ref('admins').get(),
  ]);

  const captainsByDate = captainsSnap.val() || {};
  const superKupa = superKupaSnap.val() || {};
  const admins = adminsSnap.val() || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Migrate captains ---
    let captainCount = 0;
    for (const [date, teams] of Object.entries(captainsByDate)) {
      if (!teams || typeof teams !== 'object') continue;
      for (const [teamKey, record] of Object.entries(teams)) {
        if (!record || typeof record !== 'object') continue;
        const r = record;
        await client.query(
          `INSERT INTO batak_captains (date, team_key, steam_id, steam_name, team_name, set_by_uid, set_by_name, set_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (date, team_key) DO NOTHING`,
          [
            date,
            teamKey,
            r.steamId || '',
            r.steamName || null,
            r.teamName || null,
            r.setByUid || null,
            r.setByName || null,
            r.setAt || null,
          ]
        );
        captainCount++;
      }
    }
    console.log(`[migrate-batak-allstars] Migrated ${captainCount} captain records.`);

    // --- Migrate super kupa ---
    let superKupaCount = 0;
    for (const [slot, record] of Object.entries(superKupa)) {
      if (!record || typeof record !== 'object') continue;
      const r = record;
      await client.query(
        `INSERT INTO batak_super_kupa (slot, player1_steam_id, player1_name, player1_league, player2_steam_id, player2_name, player2_league, winner_steam_id, score, date, set_by_uid, set_by_name, set_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (slot) DO NOTHING`,
        [
          slot,
          r.player1SteamId || '',
          r.player1Name || '',
          r.player1League || '',
          r.player2SteamId || '',
          r.player2Name || '',
          r.player2League || '',
          r.winnerSteamId || null,
          r.score || null,
          r.date || null,
          r.setByUid || null,
          r.setByName || null,
          r.setAt || null,
        ]
      );
      superKupaCount++;
    }
    console.log(`[migrate-batak-allstars] Migrated ${superKupaCount} super kupa match records.`);

    // --- Migrate admins ---
    let adminCount = 0;
    for (const [uid, value] of Object.entries(admins)) {
      if (value !== true) continue;
      await client.query(
        `INSERT INTO admins (uid, is_admin, updated_at)
         VALUES ($1, true, NOW())
         ON CONFLICT (uid) DO NOTHING`,
        [uid]
      );
      adminCount++;
    }
    console.log(`[migrate-batak-allstars] Migrated ${adminCount} admin records.`);

    // Bump versions so clients pick up the data
    await client.query(
      `UPDATE live_version SET version = version + 1 WHERE key IN ('batak_captains', 'batak_super_kupa')`
    );

    await client.query('COMMIT');
    console.log('[migrate-batak-allstars] All migrations committed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[migrate-batak-allstars] Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
  console.log('[migrate-batak-allstars] Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

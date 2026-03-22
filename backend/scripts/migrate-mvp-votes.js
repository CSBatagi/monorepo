#!/usr/bin/env node
/**
 * One-time migration: copy MVP votes and locks from Firebase RTDB to PostgreSQL.
 *
 * Usage:
 *   node scripts/migrate-mvp-votes.js
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

  console.log('[migrate-mvp-votes] Reading mvpVotes from Firebase RTDB...');

  const db = adminDb();
  const [votesSnap, locksSnap] = await Promise.all([
    db.ref('mvpVotes/votesByDate').get(),
    db.ref('mvpVotes/lockedByDate').get(),
  ]);

  const votesByDate = votesSnap.val() || {};
  const lockedByDate = locksSnap.val() || {};

  // Migrate votes
  let voteCount = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [date, votes] of Object.entries(votesByDate)) {
      if (!votes || typeof votes !== 'object') continue;
      for (const [voterSteamId, votedForSteamId] of Object.entries(votes)) {
        if (typeof votedForSteamId !== 'string') continue;
        await client.query(
          `INSERT INTO mvp_votes (date, voter_steam_id, voted_for_steam_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (date, voter_steam_id) DO NOTHING`,
          [date, voterSteamId, votedForSteamId]
        );
        voteCount++;
      }
    }

    // Migrate locks
    let lockCount = 0;
    for (const [date, lockData] of Object.entries(lockedByDate)) {
      if (!lockData) continue;
      const locked = lockData === true || (typeof lockData === 'object' && lockData.locked);
      if (!locked) continue;

      const lockedByUid = typeof lockData === 'object' ? lockData.lockedByUid || null : null;
      const lockedByName = typeof lockData === 'object' ? lockData.lockedByName || null : null;
      const lockedAt = typeof lockData === 'object' ? lockData.lockedAt || null : null;

      await client.query(
        `INSERT INTO mvp_locks (date, locked, locked_by_uid, locked_by_name, locked_at, updated_at)
         VALUES ($1, true, $2, $3, $4, NOW())
         ON CONFLICT (date) DO NOTHING`,
        [date, lockedByUid, lockedByName, lockedAt]
      );
      lockCount++;
    }

    // Bump version so clients pick up the data
    await client.query(
      `UPDATE live_version SET version = version + 1 WHERE key = 'mvp_votes'`
    );

    await client.query('COMMIT');
    console.log(`[migrate-mvp-votes] Migrated ${voteCount} votes, ${lockCount} locks.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[migrate-mvp-votes] Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
  console.log('[migrate-mvp-votes] Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

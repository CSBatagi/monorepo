// Live state routes — replaces Firebase RTDB for attendance + team picker
// All data is in PostgreSQL on the same VM (sub-millisecond queries)

const express = require('express');
const router = express.Router();

// Pool is injected via setup function
let pool = null;

function setup(dbPool) {
  pool = dbPool;
}

// --- Helper: bump version counter ---
async function bumpVersion(key, queryable) {
  await (queryable || pool).query(
    `UPDATE live_version SET version = version + 1 WHERE key = $1`,
    [key]
  );
}

async function getVersion(key) {
  const r = await pool.query(`SELECT version FROM live_version WHERE key = $1`, [key]);
  return r.rows[0]?.version ?? 0;
}

// =============================================================================
// ATTENDANCE
// =============================================================================

// GET /live/attendance?v=N — returns all attendance data + version
// If client version matches, returns 304
router.get('/attendance', async (req, res) => {
  try {
    const clientVersion = parseInt(req.query.v) || 0;
    const serverVersion = await getVersion('attendance');

    if (clientVersion && clientVersion >= serverVersion) {
      return res.status(304).end();
    }

    const rows = await pool.query(
      `SELECT steam_id, name, status, emoji_status, is_kaptan, kaptan_timestamp FROM attendance ORDER BY name`
    );

    // Build the response in Firebase-compatible format for easy migration
    const attendance = {};
    const emojis = {};
    const kaptanlik = {};

    for (const r of rows.rows) {
      attendance[r.steam_id] = { name: r.name, status: r.status };
      emojis[r.steam_id] = { name: r.name, status: r.emoji_status };
      kaptanlik[r.steam_id] = {
        name: r.name,
        isKaptan: r.is_kaptan,
        timestamp: r.kaptan_timestamp ? Number(r.kaptan_timestamp) : null,
      };
    }

    res.json({ version: serverVersion, attendance, emojis, kaptanlik });
  } catch (e) {
    console.error('[live/attendance GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/attendance/bulk — upsert multiple players at once
// Body: { players: [{ steamId, name, status?, emoji_status?, is_kaptan?, kaptan_timestamp? }] }
// NOTE: Must be defined BEFORE /attendance/:steamId to avoid Express matching 'bulk' as a steamId.
router.post('/attendance/bulk', async (req, res) => {
  try {
    const { players } = req.body;
    if (!Array.isArray(players)) {
      return res.status(400).json({ error: 'players array required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of players) {
        await client.query(
          `INSERT INTO attendance (steam_id, name, status, emoji_status, is_kaptan, kaptan_timestamp, updated_at)
           VALUES ($1, $2, COALESCE($3, 'no_response'), COALESCE($4, 'normal'), COALESCE($5, false), $6, NOW())
           ON CONFLICT (steam_id) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, attendance.name),
             status = COALESCE($3, attendance.status),
             emoji_status = COALESCE($4, attendance.emoji_status),
             is_kaptan = COALESCE($5, attendance.is_kaptan),
             kaptan_timestamp = CASE WHEN $5 = false THEN NULL WHEN $6 IS NOT NULL THEN $6 ELSE attendance.kaptan_timestamp END,
             updated_at = NOW()`,
          [p.steamId, p.name, p.status || null, p.emoji_status || null, p.is_kaptan ?? null, p.kaptan_timestamp ?? null]
        );
      }
      await bumpVersion('attendance', client);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const version = await getVersion('attendance');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/attendance/bulk POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/attendance/reset — clear all attendance (admin action)
// NOTE: Must be defined BEFORE /attendance/:steamId to avoid Express matching 'reset' as a steamId.
router.post('/attendance/reset', async (req, res) => {
  try {
    await pool.query(`DELETE FROM attendance`);
    await bumpVersion('attendance');
    const version = await getVersion('attendance');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/attendance/reset POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/attendance/:steamId — upsert one player's attendance/emoji/kaptan
// Body: { name, status?, emoji_status?, is_kaptan?, kaptan_timestamp? }
router.post('/attendance/:steamId', async (req, res) => {
  try {
    const { steamId } = req.params;
    const { name, status, emoji_status, is_kaptan, kaptan_timestamp } = req.body;

    if (!steamId || !name) {
      return res.status(400).json({ error: 'steamId and name required' });
    }

    await pool.query(
      `INSERT INTO attendance (steam_id, name, status, emoji_status, is_kaptan, kaptan_timestamp, updated_at)
       VALUES ($1, $2, COALESCE($3, 'no_response'), COALESCE($4, 'normal'), COALESCE($5, false), $6, NOW())
       ON CONFLICT (steam_id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, attendance.name),
         status = COALESCE($3, attendance.status),
         emoji_status = COALESCE($4, attendance.emoji_status),
         is_kaptan = COALESCE($5, attendance.is_kaptan),
         kaptan_timestamp = CASE WHEN $5 = false THEN NULL WHEN $6 IS NOT NULL THEN $6 ELSE attendance.kaptan_timestamp END,
         updated_at = NOW()`,
      [steamId, name, status || null, emoji_status || null, is_kaptan ?? null, kaptan_timestamp ?? null]
    );

    await bumpVersion('attendance');
    const version = await getVersion('attendance');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/attendance POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// TEAM PICKER
// =============================================================================

// GET /live/team-picker?v=N — returns full team picker state + version
router.get('/team-picker', async (req, res) => {
  try {
    const clientVersion = parseInt(req.query.v) || 0;
    const serverVersion = await getVersion('team_picker');

    if (clientVersion && clientVersion >= serverVersion) {
      return res.status(304).end();
    }

    const r = await pool.query(`SELECT * FROM team_picker WHERE id = 1`);
    const row = r.rows[0];
    if (!row) {
      return res.json({
        version: serverVersion,
        teamA: { players: {}, nameMode: 'generic', captainSteamId: '', kabile: '' },
        teamB: { players: {}, nameMode: 'generic', captainSteamId: '', kabile: '' },
        maps: {},
        overrides: {},
      });
    }

    res.json({
      version: serverVersion,
      teamA: {
        players: row.team_a_players || {},
        nameMode: row.team_a_name_mode || 'generic',
        captainSteamId: row.team_a_captain || '',
        kabile: row.team_a_kabile || '',
      },
      teamB: {
        players: row.team_b_players || {},
        nameMode: row.team_b_name_mode || 'generic',
        captainSteamId: row.team_b_captain || '',
        kabile: row.team_b_kabile || '',
      },
      maps: row.maps || {},
      overrides: row.overrides || {},
    });
  } catch (e) {
    console.error('[live/team-picker GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/team-picker/assign — assign player to a team
// Body: { steamId, team: 'A'|'B', player: { steamId, name, stats... } }
router.post('/team-picker/assign', async (req, res) => {
  try {
    const { steamId, team, player } = req.body;
    if (!steamId || !team || !player) {
      return res.status(400).json({ error: 'steamId, team, and player required' });
    }

    const col = team === 'A' ? 'team_a_players' : 'team_b_players';
    const otherCol = team === 'A' ? 'team_b_players' : 'team_a_players';

    // Add to target team, remove from other team
    await pool.query(
      `UPDATE team_picker SET
        ${col} = ${col} || $1::jsonb,
        ${otherCol} = ${otherCol} - $2,
        updated_at = NOW()
       WHERE id = 1`,
      [JSON.stringify({ [steamId]: player }), steamId]
    );

    await bumpVersion('team_picker');
    const version = await getVersion('team_picker');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/team-picker/assign POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/team-picker/remove — remove player from a team
// Body: { steamId, team: 'A'|'B' }
router.post('/team-picker/remove', async (req, res) => {
  try {
    const { steamId, team } = req.body;
    if (!steamId || !team) {
      return res.status(400).json({ error: 'steamId and team required' });
    }

    const col = team === 'A' ? 'team_a_players' : 'team_b_players';

    await pool.query(
      `UPDATE team_picker SET ${col} = ${col} - $1, updated_at = NOW() WHERE id = 1`,
      [steamId]
    );

    await bumpVersion('team_picker');
    const version = await getVersion('team_picker');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/team-picker/remove POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/team-picker/update — partial update (maps, nameMode, captain, overrides, kabile)
// Body: { field: value, ... } where fields can be:
//   teamA_nameMode, teamB_nameMode, teamA_captain, teamB_captain,
//   teamA_kabile, teamB_kabile, maps, overrides
router.post('/team-picker/update', async (req, res) => {
  try {
    const updates = req.body;
    const sets = [];
    const params = [];
    let paramIdx = 1;

    const fieldMap = {
      teamA_nameMode: 'team_a_name_mode',
      teamB_nameMode: 'team_b_name_mode',
      teamA_captain: 'team_a_captain',
      teamB_captain: 'team_b_captain',
      teamA_kabile: 'team_a_kabile',
      teamB_kabile: 'team_b_kabile',
    };

    for (const [key, val] of Object.entries(updates)) {
      if (fieldMap[key]) {
        sets.push(`${fieldMap[key]} = $${paramIdx}`);
        params.push(val);
        paramIdx++;
      } else if (key === 'maps' || key === 'overrides') {
        sets.push(`${key} = $${paramIdx}`);
        params.push(JSON.stringify(val));
        paramIdx++;
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    sets.push('updated_at = NOW()');
    await pool.query(`UPDATE team_picker SET ${sets.join(', ')} WHERE id = 1`, params);

    await bumpVersion('team_picker');
    const version = await getVersion('team_picker');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/team-picker/update POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/team-picker/override — update a single player's stat overrides
// Body: { steamId, stats: { L10_HLTV2: number, ... } | null }
router.post('/team-picker/override', async (req, res) => {
  try {
    const { steamId, stats } = req.body;
    if (!steamId) {
      return res.status(400).json({ error: 'steamId required' });
    }

    if (stats === null || stats === undefined) {
      // Remove override for this player
      await pool.query(
        `UPDATE team_picker SET overrides = overrides - $1, updated_at = NOW() WHERE id = 1`,
        [steamId]
      );
    } else {
      // Set/update override
      await pool.query(
        `UPDATE team_picker SET overrides = overrides || $1::jsonb, updated_at = NOW() WHERE id = 1`,
        [JSON.stringify({ [steamId]: stats })]
      );
    }

    await bumpVersion('team_picker');
    const version = await getVersion('team_picker');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/team-picker/override POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /live/team-picker/reset — reset everything
router.post('/team-picker/reset', async (req, res) => {
  try {
    await pool.query(
      `UPDATE team_picker SET
        team_a_players = '{}', team_b_players = '{}',
        team_a_name_mode = 'generic', team_b_name_mode = 'generic',
        team_a_captain = '', team_b_captain = '',
        team_a_kabile = '', team_b_kabile = '',
        maps = '{}', overrides = '{}',
        updated_at = NOW()
       WHERE id = 1`
    );
    await bumpVersion('team_picker');
    const version = await getVersion('team_picker');
    res.json({ ok: true, version });
  } catch (e) {
    console.error('[live/team-picker/reset POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, setup };

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STEAM_ID = /^7656119\d{10}$/;
const STEAM_AUTH_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS steam_members (steam_id TEXT PRIMARY KEY, uid TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, avatar_url TEXT, legacy_email TEXT UNIQUE, is_admin BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];

function sessionUser(token, secret, allowLegacy = false) {
  try {
    if (!secret || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const user = JSON.parse(Buffer.from(body, 'base64url'));
    if (!Number.isFinite(user.exp) || user.exp <= Date.now() / 1000 || typeof user.uid !== 'string' || !user.uid) return null;
    if (user.provider === 'steam' && typeof user.steamId === 'string' && user.steamId.length === 17 && STEAM_ID.test(user.steamId)) return user;
    return allowLegacy && !user.provider && typeof user.email === 'string' && user.email ? user : null;
  } catch { return null; }
}

async function isSteamAdmin(pool, steamId) {
  return (await pool.query('SELECT 1 FROM steam_members WHERE steam_id=$1 AND is_admin=true', [steamId])).rows.length > 0;
}

function rosterMember(steamId) {
  const files = [process.env.PLAYERS_FILE, path.join(__dirname, 'players.json'), path.join(__dirname, '../frontend-nextjs/public/data/players.json')].filter(Boolean);
  const file = files.find(file => fs.existsSync(file));
  if (!file) throw new Error('Player roster unavailable');
  return JSON.parse(fs.readFileSync(file, 'utf8')).find(player => player.steamId === steamId);
}

function registerSteamAuthRoutes(app, { pool, lookupRoster = rosterMember }) {
  const bearer = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!process.env.AUTH_TOKEN || req.get('authorization') !== `Bearer ${process.env.AUTH_TOKEN}`) return res.sendStatus(403);
    next();
  };
  // Only the website server may call this, after verifying Steam's OpenID assertion.
  app.post('/auth/steam/session', bearer, async (req, res) => {
    const { steamId, name, picture } = req.body || {};
    if (typeof steamId !== 'string' || !STEAM_ID.test(steamId)) return res.sendStatus(400);
    let client;
    try {
      const player = lookupRoster(steamId);
      if (!player) return res.status(403).json({ error: 'not_member' });
      const legacy = sessionUser(req.get('x-legacy-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN, true);
      client = await pool.connect();
      await client.query('BEGIN');
      // Serialize concurrent first sign-ins for this SteamID.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [steamId]);
      let member = (await client.query('SELECT * FROM steam_members WHERE steam_id=$1 FOR UPDATE', [steamId])).rows[0];
      if (!member) {
        let prior = legacy && !legacy.provider ? legacy : null;
        if (prior) {
          const link = (await client.query('SELECT steam_id FROM cosmetic_accounts WHERE email=$1', [prior.email])).rows[0];
          const used = (await client.query('SELECT 1 FROM steam_members WHERE uid=$1 OR legacy_email=$2', [prior.uid, prior.email])).rows.length;
          if (used || (link?.steam_id && link.steam_id !== steamId)) prior = null;
        }
        const admin = prior ? (await client.query('SELECT 1 FROM admins WHERE email=$1 AND is_admin=true', [prior.email])).rows.length > 0 : false;
        member = (await client.query(`INSERT INTO steam_members(steam_id,uid,display_name,legacy_email,is_admin) VALUES($1,$2,$3,$4,$5) RETURNING *`, [steamId, prior?.uid || steamId, player?.name || steamId, prior?.email || null, admin])).rows[0];
      }
      const displayName = typeof name === 'string' && name.trim() ? name.trim().slice(0,100) : player?.name || member.display_name;
      const avatar = typeof picture === 'string' && /^https:\/\/(avatars\.(akamai\.)?steamstatic\.com|steamcdn-a\.akamaihd\.net)\//.test(picture) ? picture : null;
      await client.query('UPDATE steam_members SET display_name=$2,avatar_url=$3,last_login_at=NOW() WHERE steam_id=$1', [steamId, displayName, avatar]);
      await client.query('COMMIT');
      res.json({ uid: member.uid, steamId, provider: 'steam', name: displayName, picture: avatar });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('[steam-login]', error.code || 'unavailable');
      res.status(error.code === '23505' ? 409 : 503).json({ error: 'account_unavailable' });
    } finally { client?.release(); }
  });
  // Renew only an existing, unexpired identity. No provisioning or role migration.
  app.post('/auth/steam/refresh', bearer, async (req, res) => {
    const user = sessionUser(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!user) return res.status(401).json({ error: 'invalid_session' });
    try {
      if (!lookupRoster(user.steamId)) return res.status(403).json({ error: 'not_member' });
      const member = (await pool.query('SELECT uid,display_name,avatar_url FROM steam_members WHERE steam_id=$1 AND uid=$2', [user.steamId, user.uid])).rows[0];
      if (!member) return res.status(401).json({ error: 'invalid_session' });
      res.json({ uid: member.uid, steamId: user.steamId, provider: 'steam', name: member.display_name, picture: member.avatar_url });
    } catch {
      res.status(503).json({ error: 'account_unavailable' });
    }
  });
  app.get('/auth/admin', bearer, async (req, res) => {
    const user = sessionUser(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!user) return res.status(401).json({ isAdmin: false });
    try { res.json({ isAdmin: await isSteamAdmin(pool, user.steamId) }); }
    catch { res.status(503).json({ isAdmin: false }); }
  });
}

module.exports = { STEAM_AUTH_MIGRATIONS, sessionUser, isSteamAdmin, registerSteamAuthRoutes };

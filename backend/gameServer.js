const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validateMatch(input) {
  const n = input?.players_per_team;
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('Choose between 1 and 10 players per team');
  const ids = [];
  const teams = ['team1', 'team2'].map(key => {
    const team = input[key];
    const entries = Object.entries(team?.players || {});
    if (entries.length !== n) throw new Error('Both rosters must match the selected team size');
    for (const [id, name] of entries) {
      if (!/^7656119\d{10}$/.test(id) || typeof name !== 'string' || name.length > 100) throw new Error('Invalid player identity');
      ids.push(id);
    }
    if (typeof team.name !== 'string' || !team.name.trim() || team.name.length > 80) throw new Error('Invalid team name');
    if (/[";\r\n\\]/.test(team.name)) throw new Error('Unsupported characters in team name');
    return { name: team.name, players: Object.fromEntries(entries) };
  });
  if (new Set(ids).size !== ids.length) throw new Error('A player cannot appear in both teams');
  const maps = input.maplist;
  if (!Array.isArray(maps) || maps.length < 1 || maps.length > 3 || maps.some(m => !/^de_[a-z0-9_]+$/.test(m))) throw new Error('Invalid map selection');
  const sides = input.map_sides;
  if (!Array.isArray(sides) || sides.length !== maps.length || sides.some(s => !['team1_ct', 'team1_t', 'team2_ct', 'team2_t', 'knife'].includes(s))) throw new Error('Invalid starting sides');
  return { matchid: crypto.randomInt(1, 2147483647), team1: teams[0], team2: teams[1], players_per_team: n,
    min_players_to_ready: 0, num_maps: maps.length, maplist: maps, map_sides: sides.map(s => s === 'knife' ? 'team1_ct' : s),
    clinch_series: true, spectators: { players: {} }, cvars: {} };
}

function sessionEmail(token, secret) {
  try {
    if (!secret || !token) return null;
    const [header, body, signature, extra] = token.split('.');
    if (extra !== undefined) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url'));
    return payload.exp > Date.now() / 1000 && typeof payload.email === 'string' ? payload.email : null;
  } catch { return null; }
}

function registerGameServer(app, { pool, rcon, gcp }) {
  const directory = process.env.CS2_MATCH_DIR || path.join(__dirname, 'cs2-control');
  fs.mkdirSync(directory, { recursive: true });
  let loading = false;
  const admin = async (req, res, next) => {
    const email = sessionEmail(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!email) return res.status(401).json({ error: 'Sign in to control the game server' });
    try {
      const result = await pool.query('SELECT 1 FROM admins WHERE email=$1 AND is_admin=true', [email]);
      if (!result.rows.length) return res.status(403).json({ error: 'Game server controls require an admin' });
      next();
    } catch { res.status(503).json({ error: 'Unable to check admin access' }); }
  };
  const bearer = (req, res, next) => {
    if (!process.env.AUTH_TOKEN || req.get('authorization') !== `Bearer ${process.env.AUTH_TOKEN}`) return res.sendStatus(403);
    next();
  };
  app.get('/get-match/:id', bearer, (req, res) => {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id) || Number(req.params.id) > 2147483647) return res.sendStatus(400);
    const file = path.join(directory, req.params.id + '.json');
    if (!fs.existsSync(file)) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').type('json').send(fs.readFileSync(file));
  });
  app.get('/get-match', (_req, res) => res.status(410).json({ error: 'Use an authenticated match-ID URL' }));
  app.post('/start-match', admin, async (req, res) => {
    if (loading) return res.status(409).json({ error: 'Another match is being loaded' });
    let match;
    try { match = validateMatch(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    loading = true;
    try {
      const status = await rcon.status();
      if (status.live || status.preparing) return res.status(409).json({ error: 'A match is already active' });
      fs.writeFileSync(path.join(directory, match.matchid + '.json'), JSON.stringify(match), { flag: 'wx', mode: 0o640 });
      const loaded = await rcon.startMatch(match.matchid);
      res.json({ message: 'Match loaded; waiting for both teams to ready', matchid: match.matchid, status: loaded });
    } catch (error) { res.status(502).json({ error: error.message, matchid: match.matchid }); }
    finally { loading = false; }
  });
  app.get('/game-status', bearer, admin, async (_req, res) => {
    try { res.json(await rcon.status()); } catch (error) { res.status(503).json({ error: error.message }); }
  });
  app.post('/load-plugins', admin, async (_req, res) => {
    try { res.json({ message: 'Match manager is loaded', status: await rcon.status() }); }
    catch (error) { res.status(503).json({ error: error.message }); }
  });
  app.post('/start-vm', admin, async (_req, res) => {
    const result = await gcp.startVm();
    res.status(result.success ? 200 : 502).json(result);
  });
  app.post('/stop-vm', admin, async (_req, res) => {
    try {
      const status = await rcon.status();
      if (status.live || status.preparing || status.recording || status.uploads?.pending !== 0 || Date.now() / 1000 - (status.uploads?.updatedAt || 0) > 120)
        return res.status(409).json({ error: 'Finish the match and wait for verified demo uploads before stopping the VM' });
      await rcon.executeCommand('quit').catch(() => {});
      const result = await gcp.stopVm();
      res.status(result.success ? 200 : 502).json(result);
    } catch (error) { res.status(503).json({ error: error.message }); }
  });
}

module.exports = { registerGameServer, validateMatch, sessionEmail };

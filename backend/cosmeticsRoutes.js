const crypto = require('crypto');
const { sessionEmail } = require('./gameServer');
const { catalog, emptyState, validateState, equipped } = require('./cosmetics');

const COSMETICS_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cosmetic_accounts (email TEXT PRIMARY KEY, steam_id TEXT UNIQUE, state JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_fetched_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS cosmetic_link_codes (email TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`
];
const hash = code => crypto.createHash('sha256').update(code).digest('hex');

function registerCosmeticsRoutes(app, { pool }) {
  const bearer = (req, res, next) => {
    if (!process.env.AUTH_TOKEN || req.get('authorization') !== `Bearer ${process.env.AUTH_TOKEN}`) return res.status(403).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    next();
  };
  const member = (req, res, next) => {
    const email = sessionEmail(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!email) return res.status(401).json({ error: 'Önce giriş yapın.' });
    req.cosmeticEmail = email;
    next();
  };
  // Register before the general IP limiter: authenticated sessions have their own bounded budget.
  const budgets = new Map();
  const limit = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of budgets) if (value.until < now) budgets.delete(key);
    const key = req.cosmeticEmail || 'game-server';
    const budget = budgets.get(key) || { until: now + 60000, count: 0 };
    budgets.set(key, budget);
    if (++budget.count > (req.cosmeticEmail ? 120 : 240)) return res.status(429).json({ error: 'Bir dakika bekleyip tekrar deneyin.' });
    next();
  };
  const safe = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Bu Steam hesabı zaten başka bir üyeye bağlı.' });
      console.error('[cosmetics]', error.code || 'request_failed');
      res.status(503).json({ error: 'Ekipman hizmetine şu anda ulaşılamıyor.' });
    }
  };
  app.get('/cosmetics/catalog', bearer, member, limit, (req, res) => {
    const q = String(req.query.q || '').slice(0, 100).toLowerCase();
    const kind = String(req.query.kind || 'weapon');
    const weapon = String(req.query.weapon || '');
    const offset = Math.max(0, Math.min(20000, parseInt(req.query.offset, 10) || 0));
    const items = catalog.items.filter(item => item.kind === kind && (!weapon || item.weapon === weapon) && item.name.toLowerCase().includes(q));
    res.json({ revision: catalog.revision, total: items.length, items: items.slice(offset, offset + 48), weapons: [...new Set(catalog.items.filter(item => item.kind === kind && item.weapon).map(item => item.weapon))].sort() });
  });
  app.get('/cosmetics/me', bearer, member, limit, safe(async (req, res) => {
    const { rows } = await pool.query('SELECT steam_id, state, revision, last_fetched_at FROM cosmetic_accounts WHERE email=$1', [req.cosmeticEmail]);
    const account = rows[0];
    const state = account?.state || emptyState();
    const ids = new Set(state.profiles.flatMap(p => p.items.flatMap(i => [i.id, ...(i.stickers || []), i.charm])));
    res.json({ steamId: account?.steam_id || null, revision: account?.revision || 0, state, lastFetchedAt: account?.last_fetched_at || null, items: catalog.items.filter(item => ids.has(item.id)) });
  }));
  app.post('/cosmetics/save', bearer, member, limit, safe(async (req, res) => {
    let state;
    try { state = validateState(req.body?.state); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!Number.isInteger(req.body.revision) || req.body.revision < 0) return res.status(400).json({ error: 'Geçersiz sürüm.' });
    const { rows } = await pool.query(`UPDATE cosmetic_accounts SET state=$2, revision=revision+1, updated_at=NOW() WHERE email=$1 AND steam_id IS NOT NULL AND revision=$3 RETURNING revision`, [req.cosmeticEmail, JSON.stringify(state), req.body.revision]);
    if (!rows.length) return res.status(409).json({ error: 'Önce Steam hesabınızı bağlayın veya değişen ekipmanı yeniden yükleyin.' });
    res.json({ revision: rows[0].revision, state });
  }));
  app.post('/cosmetics/link-code', bearer, member, limit, safe(async (req, res) => {
    const code = crypto.randomBytes(8).toString('hex').toUpperCase();
    await pool.query(`INSERT INTO cosmetic_link_codes(email, code_hash, expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes') ON CONFLICT(email) DO UPDATE SET code_hash=$2, expires_at=EXCLUDED.expires_at`, [req.cosmeticEmail, hash(code)]);
    res.json({ code, expiresIn: 600 });
  }));
  // Identity comes only from the authenticated game plugin's connected player controller.
  app.post('/cosmetics/server/link', bearer, limit, safe(async (req, res) => {
    const { code, steamId } = req.body || {};
    if (!/^[A-F0-9]{16}$/.test(code) || typeof steamId !== 'string' || !/^7656119\d{10}$/.test(steamId)) return res.status(400).json({ error: 'Invalid link code or Steam ID' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('DELETE FROM cosmetic_link_codes WHERE code_hash=$1 AND expires_at>NOW() RETURNING email', [hash(code)]);
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Code expired or already used' }); }
      const existing = await client.query('SELECT steam_id FROM cosmetic_accounts WHERE email=$1 FOR UPDATE', [rows[0].email]);
      if (existing.rows[0]?.steam_id && existing.rows[0].steam_id !== steamId) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Account is already linked; contact an administrator' }); }
      await client.query(`INSERT INTO cosmetic_accounts(email,steam_id,state) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET steam_id=$2, updated_at=NOW()`, [rows[0].email, steamId, JSON.stringify(emptyState())]);
      await client.query('COMMIT');
      res.json({ linked: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }));
  app.get('/cosmetics/api/equipped/v5/:file', bearer, limit, safe(async (req, res) => {
    const match = /^(7656119\d{10})\.json$/.exec(req.params.file);
    if (!match) return res.sendStatus(400);
    const { rows } = await pool.query('UPDATE cosmetic_accounts SET last_fetched_at=NOW() WHERE steam_id=$1 RETURNING state', [match[1]]);
    res.json(equipped(rows[0]?.state || emptyState()));
  }));
}
module.exports = { registerCosmeticsRoutes, COSMETICS_MIGRATIONS };

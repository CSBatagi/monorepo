const crypto = require('crypto');
const { sessionEmail } = require('./gameServer');
const { catalog, byId, emptyState, validateState, equipped } = require('./cosmetics');
const { TIERS, itemAccess, progressView, levelFor, owns, assertOwnership, ownedState } = require('./cosmeticProgression');
const { PROGRESSION_MIGRATIONS, transaction, lockWallet, unlocksFor, syncRewards, walletView } = require('./cosmeticProgressionStore');
const { resolveSeasonConfig } = require('./seasonConfig');

const COSMETICS_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cosmetic_accounts (email TEXT PRIMARY KEY, steam_id TEXT UNIQUE, state JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_fetched_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS cosmetic_link_codes (email TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`,
  ...PROGRESSION_MIGRATIONS,
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
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'Bu Steam hesabı zaten başka bir üyeye bağlı.' });
      console.error('[cosmetics]', error.code || 'request_failed');
      res.status(503).json({ error: 'Ekipman hizmetine şu anda ulaşılamıyor.' });
    }
  };
  const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
  async function requireAdmin(email) {
    const { rows } = await pool.query('SELECT 1 FROM admins WHERE email=$1 AND is_admin=true', [email]);
    if (!rows.length) fail(403, 'Bu işlem yalnızca yöneticilere açık.');
  }
  async function linkedSteam(client, email) {
    const { rows } = await client.query('SELECT steam_id FROM cosmetic_accounts WHERE email=$1', [email]);
    if (!rows[0]?.steam_id) fail(409, 'Önce Steam hesabınızı bağlayın.');
    return rows[0].steam_id;
  }
  const decorate = item => ({ ...item, access: itemAccess(item) });
  app.get('/cosmetics/catalog', bearer, member, limit, (req, res) => {
    const q = String(req.query.q || '').slice(0, 100).toLowerCase();
    const kind = String(req.query.kind || 'weapon');
    const weapon = String(req.query.weapon || '');
    const offset = Math.max(0, Math.min(20000, parseInt(req.query.offset, 10) || 0));
    const tier = String(req.query.tier || '');
    const items = catalog.items.filter(item => item.kind === kind && (!tier || itemAccess(item).tier === tier) && (!weapon || item.weapon === weapon) && item.name.toLowerCase().includes(q));
    res.json({ revision: catalog.revision, total: items.length, items: items.slice(offset, offset + 48).map(decorate), weapons: [...new Set(catalog.items.filter(item => item.kind === kind && item.weapon).map(item => item.weapon))].sort() });
  });
  app.get('/cosmetics/me', bearer, member, limit, safe(async (req, res) => {
    const { rows } = await pool.query('SELECT steam_id, state, revision, last_fetched_at FROM cosmetic_accounts WHERE email=$1', [req.cosmeticEmail]);
    const account = rows[0];
    const progress = account?.steam_id ? await transaction(pool, async client => walletView(client, account.steam_id, await syncRewards(client, account.steam_id))) : null;
    const rawState = account?.state || emptyState();
    const state = ownedState(rawState, new Set(progress?.unlocks || []));
    const ids = new Set(state.profiles.flatMap(p => p.items.flatMap(i => [i.id, ...(i.stickers || []), i.charm])));
    const isAdmin = (await pool.query('SELECT 1 FROM admins WHERE email=$1 AND is_admin=true', [req.cosmeticEmail])).rows.length > 0;
    const startsAt = (await pool.query('SELECT starts_at FROM cosmetic_economy WHERE id=1')).rows[0]?.starts_at;
    res.json({ steamId: account?.steam_id || null, revision: account?.revision || 0, state, lastFetchedAt: account?.last_fetched_at || null, items: catalog.items.filter(item => ids.has(item.id)).map(decorate), progress, isAdmin, startsAt, tiers: Object.values(TIERS), removedLockedItems: JSON.stringify(rawState) !== JSON.stringify(state) });
  }));
  app.post('/cosmetics/save', bearer, member, limit, safe(async (req, res) => {
    let state;
    try { state = validateState(req.body?.state); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!Number.isInteger(req.body.revision) || req.body.revision < 0) return res.status(400).json({ error: 'Geçersiz sürüm.' });
    const rows = await transaction(pool, async client => {
      const steamId = await linkedSteam(client, req.cosmeticEmail);
      await lockWallet(client, steamId);
      assertOwnership(state, await unlocksFor(client, steamId));
      return (await client.query(`UPDATE cosmetic_accounts SET state=$2, revision=revision+1, updated_at=NOW() WHERE email=$1 AND steam_id IS NOT NULL AND revision=$3 RETURNING revision`, [req.cosmeticEmail, JSON.stringify(state), req.body.revision])).rows;
    });
    if (!rows.length) return res.status(409).json({ error: 'Önce Steam hesabınızı bağlayın veya değişen ekipmanı yeniden yükleyin.' });
    res.json({ revision: rows[0].revision, state });
  }));
  app.post('/cosmetics/unlock', bearer, member, limit, safe(async (req, res) => {
    const item = byId.get(req.body?.itemId);
    if (!item) return res.status(400).json({ error: 'Geçersiz eşya.' });
    const result = await transaction(pool, async client => {
      const steamId = await linkedSteam(client, req.cosmeticEmail);
      const wallet = await syncRewards(client, steamId);
      const unlocks = await unlocksFor(client, steamId);
      const access = itemAccess(item);
      if (!owns(item.id, unlocks)) {
        if (levelFor(wallet.xp) < access.level) fail(409, `Bu eşya için seviye ${access.level} gerekli.`);
        const column = access.currency === 'premiumTokens' ? 'premium_tokens' : 'tokens';
        if (wallet[column] < access.cost) fail(409, access.currency === 'premiumTokens' ? 'Yönetici tarafından verilen bir premium jeton gerekli.' : 'Yeterli jetonun yok. Bir sonraki maçta kazanmaya devam et!');
        // Wallet row lock serializes purchases, awards and reward settlement.
        await client.query(`UPDATE cosmetic_wallets SET ${column}=${column}-$2 WHERE steam_id=$1`, [steamId, access.cost]);
        await client.query('INSERT INTO cosmetic_unlocks(steam_id,item_id,currency,cost) VALUES($1,$2,$3,$4)', [steamId, item.id, access.currency, access.cost]);
        wallet[column] -= access.cost; unlocks.add(item.id);
      }
      return { progress: progressView(wallet, unlocks), item: decorate(item) };
    });
    res.json(result);
  }));
  app.get('/cosmetics/awards', bearer, member, limit, safe(async (req, res) => {
    await requireAdmin(req.cosmeticEmail);
    const members = await pool.query(`SELECT email,steam_id FROM cosmetic_accounts WHERE steam_id IS NOT NULL ORDER BY email LIMIT 500`);
    const awards = await pool.query(`SELECT request_id,steam_id,admin_email,amount,reason,season_start,awarded_at FROM cosmetic_premium_awards ORDER BY awarded_at DESC LIMIT 30`);
    const season = resolveSeasonConfig();
    res.json({ members: members.rows, awards: awards.rows, seasonStart: season.seasonStart, seasonStarts: season.seasonStarts });
  }));
  app.post('/cosmetics/award', bearer, member, limit, safe(async (req, res) => {
    await requireAdmin(req.cosmeticEmail);
    const { requestId, steamId, amount, reason, seasonStart } = req.body || {};
    const seasons = resolveSeasonConfig().seasonStarts;
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) || typeof steamId !== 'string' || !/^7656119\d{10}$/.test(steamId) || !Number.isInteger(amount) || amount < 1 || amount > 10 || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 200 || !seasons.includes(seasonStart)) return res.status(400).json({ error: 'Üye, sezon, 1–10 jeton ve ödül açıklaması gerekli.' });
    await transaction(pool, async client => {
      const linked = await client.query('SELECT 1 FROM cosmetic_accounts WHERE steam_id=$1', [steamId]);
      if (!linked.rows.length) fail(404, 'Bağlı Steam hesabı bulunamadı.');
      await lockWallet(client, steamId);
      const inserted = await client.query(`INSERT INTO cosmetic_premium_awards(request_id,steam_id,admin_email,amount,reason,season_start) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING request_id`, [requestId, steamId, req.cosmeticEmail, amount, reason.trim(), seasonStart]);
      if (inserted.rows.length) await client.query('UPDATE cosmetic_wallets SET premium_tokens=premium_tokens+$2 WHERE steam_id=$1', [steamId, amount]);
      else {
        const prior = (await client.query('SELECT *,season_start::text AS season_date FROM cosmetic_premium_awards WHERE request_id=$1', [requestId])).rows[0];
        if (prior.steam_id !== steamId || prior.admin_email !== req.cosmeticEmail || prior.amount !== amount || prior.reason !== reason.trim() || prior.season_date !== seasonStart) fail(409, 'Bu ödül isteği daha önce farklı bilgilerle kullanılmış.');
      }
    });
    res.json({ awarded: true });
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
    const unlocks = rows.length ? await unlocksFor(pool, match[1]) : new Set();
    res.json(equipped(ownedState(rows[0]?.state || emptyState(), unlocks)));
  }));
}
module.exports = { registerCosmeticsRoutes, COSMETICS_MIGRATIONS };

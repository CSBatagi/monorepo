const crypto = require('node:crypto');
const { connectQuery } = require('./teamSpeakQuery');
const { sessionUser, rosterMember } = require('./steamAuth');

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEAM_PROPERTY = 'csbatagi_steam_id';
const DEVICE_PROPERTY = 'csbatagi_device';
const GROUP_NAME = 'CS Batagi Steam Members';
const PROOF_MS = 180000;
const GUEST_LIMITS = {
  i_channel_join_power: -1, i_client_talk_power: -1, i_channel_subscribe_power: -1,
  i_client_private_textmessage_power: -1, i_ft_file_upload_power: -1, i_ft_file_download_power: -1,
  b_client_server_textmessage_send: 0, b_client_channel_textmessage_send: 0,
};
function unsafePermissions(permissions) {
  return permissions.some(p => Number(p.permvalue) > 0 && /(?:serverinstance|serverquery|permission_modify|group_(?:modify|member)|^b_virtualserver_(?:modify|create|delete|token)|^[bi]_client_(?:modify(?!_own_)|create|ignore_bans|ban|kick)|^b_channel_create)/.test(p.permsid));
}
function configFromEnv() {
  return { host: process.env.TEAMSPEAK_HOST || 'voice.csbatagi.com', port: 9987,
    queryHost: process.env.TEAMSPEAK_QUERY_HOST || 'teamspeak', queryPort: 10011,
    queryUser: process.env.TEAMSPEAK_QUERY_USER, queryPassword: process.env.TEAMSPEAK_QUERY_PASSWORD,
    serverId: 1, groupId: process.env.TEAMSPEAK_MEMBER_GROUP_ID,
    lobbyId: process.env.TEAMSPEAK_LOBBY_CHANNEL_ID, memberChannelId: process.env.TEAMSPEAK_MEMBER_CHANNEL_ID };
}
function configured(config) {
  return !!(config.queryUser && config.queryPassword && [config.groupId, config.lobbyId, config.memberChannelId].every(id => /^[1-9]\d*$/.test(String(id || ''))) &&
    config.lobbyId !== config.memberChannelId && /^[a-z0-9.-]+$/i.test(config.host));
}
function joinUrl(config, name, channelId) {
  const params = new URLSearchParams({ port: String(config.port), nickname: name, cid: String(channelId) });
  if (String(channelId) === String(config.memberChannelId)) params.set('addbookmark', 'CS Batağı');
  // This URL contains no password, invitation key or authorization credential.
  return 'ts3server://' + config.host + '?' + params.toString().replace(/\+/g, '%20');
}
function nickname(name, suffix = '') {
  let result = String(name || 'Üye').replace(/[\u0000-\u001f\u007f|]/g, '').trim() || 'Üye';
  while (Buffer.byteLength(result + suffix, 'utf8') > 30) result = Array.from(result).slice(0, -1).join('');
  return result + suffix;
}
async function verifyConfiguration(query, config) {
  const server = (await query.command('serverinfo'))[0];
  const groups = await query.command('servergrouplist');
  const group = groups.find(row => row.sgid === String(config.groupId));
  if (!server || server.virtualserver_flag_password !== '0' || !group || group.name !== GROUP_NAME || group.type !== '1' ||
      server.virtualserver_default_server_group === String(config.groupId)) {
    throw new Error('TeamSpeak verification configuration unsafe');
  }
  const guests = await query.command('servergrouppermlist', { sgid: server.virtualserver_default_server_group }, '-permsid');
  for (const [permsid, value] of Object.entries(GUEST_LIMITS)) {
    const permission = guests.find(p => p.permsid === permsid);
    if (!permission || Number(permission.permvalue) !== value || permission.permnegated !== '1' || permission.permskip !== '1') {
      throw new Error('Unverified TeamSpeak guests must stay restricted');
    }
  }
  if (unsafePermissions(guests)) throw new Error('Guest permissions unsafe');
  const permissions = await query.command('servergrouppermlist', { sgid: config.groupId }, '-permsid');
  if (unsafePermissions(permissions) || !permissions.some(p => p.permsid === 'i_channel_join_power' && Number(p.permvalue) >= 50) ||
      !permissions.some(p => p.permsid === 'i_client_talk_power' && Number(p.permvalue) >= 50)) throw new Error('Member group unsafe');
  const channels = await query.command('channellist', {}, '-flags');
  if (!channels.some(row => row.cid === String(config.memberChannelId)) || !channels.some(row => row.cid === String(config.lobbyId) && row.channel_flag_default === '1')) throw new Error('Missing voice channels');
  for (const channel of channels) {
    const channelPermissions = await query.command('channelpermlist', { cid: channel.cid }, '-permsid');
    const power = Number(channelPermissions.find(p => p.permsid === 'i_channel_needed_join_power')?.permvalue || 0);
    if (channel.cid === String(config.lobbyId) ? power !== -1 : power < 0) throw new Error('An unverified guest could escape the lobby');
    if (channel.cid === String(config.lobbyId) && Number(channelPermissions.find(p => p.permsid === 'i_client_needed_talk_power')?.permvalue || 0) < 0) {
      throw new Error('Verification lobby voice permissions unsafe');
    }
  }
  return server;
}

function createTeamSpeak({ lookupRoster = rosterMember, config = configFromEnv(), openQuery = connectQuery, now = Date.now,
  randomCode = () => crypto.randomBytes(5).toString('hex').toUpperCase() } = {}) {
  let tail = Promise.resolve(), queued = 0;
  const claims = new Map(), guestSeen = new Map();
  const proofSecret = crypto.randomBytes(32);
  const digest = code => crypto.createHmac('sha256', proofSecret).update(code).digest();
  const keyFor = (steamId, deviceId) => steamId + ':' + deviceId;
  function run(work) {
    if (!configured(config)) return Promise.reject(new Error('TeamSpeak not configured'));
    if (queued >= 8) return Promise.reject(new Error('TeamSpeak busy'));
    const queuedAt = now(); queued++;
    const result = tail.then(async () => {
      if (now() - queuedAt > 20000) throw new Error('TeamSpeak busy');
      const query = await openQuery(config);
      try { const server = await verifyConfiguration(query, config); return await work(query, server); }
      finally { query.close(); }
    });
    tail = result.catch(() => {}).finally(() => { queued--; });
    return result;
  }
  function cleanClaims() {
    for (const [key, claim] of claims) {
      if (claim.expiresAt <= now()) { claim.proof = null; claims.delete(key); }
    }
  }
  async function enrolled(query, steamId, deviceId) {
    for (const device of await query.command('customsearch', { ident: DEVICE_PROPERTY, pattern: deviceId })) {
      const properties = await query.command('custominfo', { cldbid: device.cldbid });
      if (properties.find(p => p.ident === STEAM_PROPERTY)?.value !== steamId) continue;
      if ((await query.command('servergroupsbyclientid', { cldbid: device.cldbid })).some(group => group.sgid === String(config.groupId))) return true;
    }
    return false;
  }
  function result(claim, name) {
    return claim ? { state: claim.state, requestId: claim.id, expiresAt: claim.expiresAt,
      url: joinUrl(config, claim.nickname, config.lobbyId) } :
      { state: 'verified', requestId: null, expiresAt: null, url: joinUrl(config, nickname(name), config.memberChannelId) };
  }
  function current(steamId, deviceId, requestId) {
    const claim = claims.get(keyFor(steamId, deviceId));
    if (!claim || claim.id !== requestId || claim.expiresAt <= now()) throw new Error('Verification expired');
    return claim;
  }
  async function clients(query) { return query.command('clientlist', {}, '-uid -groups'); }
  async function owner(query, dbId) {
    return (await query.command('custominfo', { cldbid: dbId })).find(p => p.ident === STEAM_PROPERTY)?.value;
  }
  return {
    enabled: () => configured(config),
    prepare: (steamId, deviceId, reset = false) => run(async query => {
      const player = lookupRoster(steamId);
      if (!player) throw new Error('Not a member');
      cleanClaims();
      if (!reset && await enrolled(query, steamId, deviceId)) return result(null, player.name || steamId);
      const key = keyFor(steamId, deviceId);
      const previous = claims.get(key);
      if (previous && (!reset || now() - previous.startedAt < 10000)) return result(previous);
      // Roster membership bounds accounts; per-account and global caps bound RAM.
      const others = [...claims].filter(([, claim]) => claim.steamId === steamId).sort((a, b) => a[1].startedAt - b[1].startedAt);
      for (const [stale] of others.slice(0, Math.max(0, others.length - 2))) claims.delete(stale);
      if (claims.size >= 256 && !claims.has(key)) throw new Error('Verification busy');
      const id = crypto.randomUUID();
      const claim = { id, steamId, deviceId, startedAt: now(), expiresAt: now() + PROOF_MS,
        state: 'waiting', proof: null, attempts: 0, lastPoll: null,
        nickname: nickname(player.name || 'Üye', '-CSB' + id.replace(/-/g, '').slice(0, 8)) };
      claims.set(key, claim);
      return result(claim);
    }),
    status: (steamId, deviceId, requestId) => run(async query => {
      const claim = current(steamId, deviceId, requestId);
      if (claim.state === 'code_sent' || claim.lastPoll !== null && now() - claim.lastPoll < 4000) return result(claim);
      claim.lastPoll = now();
      const candidates = (await clients(query)).filter(client => client.client_type === '0' &&
        client.client_nickname === claim.nickname && client.cid === String(config.lobbyId));
      if (candidates.length !== 1) return result(claim);
      const client = candidates[0];
      if (!client.client_unique_identifier || !/^[1-9]\d*$/.test(client.client_database_id)) throw new Error('Identity unavailable');
      const priorOwner = await owner(query, client.client_database_id);
      if (priorOwner && priorOwner !== steamId) throw new Error('Identity already linked');
      const code = randomCode();
      // The browser never receives this code from an API. Only the holder of the
      // connected TeamSpeak private identity can read its private chat message.
      await query.command('sendtextmessage', { targetmode: 1, target: client.clid,
        msg: 'CS Batağı doğrulama kodun: ' + code + '. Bu kodu yalnızca giriş yaptığın https://csbatagi.com/teamspeak sayfasına yaz. Kimseyle paylaşma. Kod 3 dakika içinde geçerlidir.' });
      claim.proof = digest(code); claim.dbId = client.client_database_id; claim.identity = client.client_unique_identifier;
      claim.state = 'code_sent';
      return result(claim);
    }),
    verify: (steamId, deviceId, requestId, code) => run(async query => {
      const claim = current(steamId, deviceId, requestId);
      if (claim.state !== 'code_sent' || !claim.proof || claim.attempts >= 5) throw new Error('Verification unavailable');
      claim.attempts++;
      const supplied = digest(code);
      if (!crypto.timingSafeEqual(claim.proof, supplied)) {
        if (claim.attempts >= 5) { claim.proof = null; claims.delete(keyFor(steamId, deviceId)); }
        throw new Error('Incorrect code');
      }
      const player = lookupRoster(steamId);
      if (!player) throw new Error('Not a member');
      const client = (await clients(query)).find(row => row.client_type === '0' &&
        row.client_database_id === claim.dbId && row.client_unique_identifier === claim.identity);
      if (!client) throw new Error('TeamSpeak client disconnected');
      const priorOwner = await owner(query, claim.dbId);
      if (priorOwner && priorOwner !== steamId) throw new Error('Identity already linked');
      // Persist ownership before granting privileges so a partial failure never
      // creates an untracked member. Never overwrite another Steam account.
      await query.command('customset', { cldbid: claim.dbId, ident: STEAM_PROPERTY, value: steamId });
      await query.command('customset', { cldbid: claim.dbId, ident: DEVICE_PROPERTY, value: deviceId });
      const groups = await query.command('servergroupsbyclientid', { cldbid: claim.dbId });
      if (!groups.some(group => group.sgid === String(config.groupId))) await query.command('servergroupaddclient', { sgid: config.groupId, cldbid: claim.dbId });
      claim.proof = null; claims.delete(keyFor(steamId, deviceId));
      await query.command('clientmove', { clid: client.clid, cid: config.memberChannelId }).catch(() => {});
      return result(null, player.name || steamId);
    }),
    maintain: () => run(async (query, server) => {
      cleanClaims();
      const connected = await clients(query);
      const removed = new Set();
      for (const identity of await query.command('customsearch', { ident: STEAM_PROPERTY, pattern: '%' })) {
        if (lookupRoster(identity.value)) continue;
        const groups = await query.command('servergroupsbyclientid', { cldbid: identity.cldbid });
        if (groups.some(group => group.sgid === String(config.groupId))) {
          await query.command('servergroupdelclient', { sgid: config.groupId, cldbid: identity.cldbid });
        }
        removed.add(identity.cldbid);
      }
      const active = new Set();
      for (const client of connected.filter(client => client.client_type === '0')) {
        active.add(client.client_unique_identifier);
        if (removed.has(client.client_database_id)) {
          try { await query.command('clientkick', { clid: client.clid, reasonid: 5, reasonmsg: 'Kulüp üyeliği sona erdi.' }); }
          catch (error) { if (error.code !== '2568') throw error; } // Independently granted native admins remain operator-controlled.
          continue;
        }
        if (client.client_servergroups === server.virtualserver_default_server_group) {
          if (!guestSeen.has(client.client_unique_identifier)) guestSeen.set(client.client_unique_identifier, now());
          if (now() - guestSeen.get(client.client_unique_identifier) >= PROOF_MS) {
            await query.command('clientkick', { clid: client.clid, reasonid: 5, reasonmsg: 'Doğrulamak için csbatagi.com/teamspeak sayfasını aç.' });
            guestSeen.delete(client.client_unique_identifier);
          }
        } else guestSeen.delete(client.client_unique_identifier);
      }
      for (const identity of guestSeen.keys()) if (!active.has(identity)) guestSeen.delete(identity);
    }),
  };
}

function registerTeamSpeak(app, { pool, lookupRoster = rosterMember, service = createTeamSpeak({ lookupRoster }), startMaintenance = true }) {
  const traffic = new Map();
  for (const action of ['join', 'status', 'verify']) app.post('/teamspeak/' + action, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!process.env.AUTH_TOKEN || req.get('authorization') !== 'Bearer ' + process.env.AUTH_TOKEN) return res.status(403).json({ error: 'Hizmet kimliği doğrulanamadı.' });
    const user = sessionUser(req.get('x-game-session'), process.env.MATCHMAKING_TOKEN || process.env.AUTH_TOKEN);
    if (!user) return res.status(401).json({ error: 'TeamSpeak için Steam ile giriş yap.' });
    const { deviceId, requestId, code, reset = false } = req.body || {};
    if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId) || typeof reset !== 'boolean' ||
        action !== 'join' && (typeof requestId !== 'string' || !DEVICE_ID.test(requestId)) ||
        action === 'verify' && (typeof code !== 'string' || !/^[0-9A-F]{10}$/i.test(code))) {
      return res.status(400).json({ error: 'Doğrulama isteği geçersiz.' });
    }
    try {
      if (!lookupRoster(user.steamId)) return res.status(403).json({ error: 'TeamSpeak yalnızca kulüp üyelerine açıktır.' });
      const found = await pool.query('SELECT 1 FROM steam_members WHERE steam_id=$1 AND uid=$2', [user.steamId, user.uid]);
      if (!found.rows.length) return res.status(403).json({ error: 'Üyelik doğrulanamadı. Yeniden Steam ile giriş yap.' });
      let limit = traffic.get(user.steamId);
      if (!limit || limit.until <= Date.now()) { limit = { until: Date.now() + 60000, calls: 0 }; traffic.set(user.steamId, limit); }
      if (++limit.calls > 30) return res.status(429).json({ error: 'Biraz bekleyip tekrar dene.' });
      if (!service.enabled()) return res.status(503).json({ error: 'TeamSpeak bağlantısı henüz etkinleştirilmedi.' });
      const value = action === 'join' ? await service.prepare(user.steamId, deviceId, reset)
        : action === 'status' ? await service.status(user.steamId, deviceId, requestId)
        : await service.verify(user.steamId, deviceId, requestId, code.toUpperCase());
      res.json(value);
    } catch (error) {
      const messages = { 'Incorrect code': 'Kod eşleşmedi. TeamSpeak özel mesajındaki kodu kontrol et.',
        'Verification expired': 'Doğrulama süresi doldu. Bağlantıyı yenile.',
        'Identity already linked': 'Bu TeamSpeak kimliği başka bir Steam hesabına bağlı. TeamSpeak içinde yeni bir kimlik oluştur.',
        'TeamSpeak client disconnected': 'TeamSpeak bağlantını açık tut ve tekrar dene.',
        'Verification unavailable': 'Doğrulama yeniden başlatılmalı. Bağlantıyı yenile.' };
      res.status(messages[error.message] ? 409 : 503).json({ error: messages[error.message] || 'TeamSpeak bağlantısı hazırlanamadı. Biraz sonra tekrar dene.' });
    }
  });
  let maintaining = false;
  const tick = async () => {
    for (const [steamId, limit] of traffic) if (limit.until <= Date.now()) traffic.delete(steamId);
    if (maintaining || !service.enabled()) return;
    maintaining = true;
    try { await service.maintain(); }
    catch { console.error('[teamspeak] Verification/membership maintenance unavailable'); }
    finally { maintaining = false; }
  };
  const timer = startMaintenance ? setInterval(tick, 60000) : null;
  timer?.unref();
  if (startMaintenance) void tick();
  return () => clearInterval(timer);
}
module.exports = { createTeamSpeak, registerTeamSpeak, joinUrl, configFromEnv, GROUP_NAME, GUEST_LIMITS, PROOF_MS, unsafePermissions, verifyConfiguration };

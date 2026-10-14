const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createTeamSpeak, registerTeamSpeak, GROUP_NAME, GUEST_LIMITS, PROOF_MS, joinUrl } = require('../teamSpeak');
const steamId = '76561198000000001';
const deviceId = 'e3e5fb89-08f2-4dab-bb7e-8aee9cbb552f';
const otherId = '22e5fb89-08f2-4dab-bb7e-8aee9cbb552f';
const config = { host: 'voice.csbatagi.com', port: 9987, queryUser: 'private', queryPassword: 'private-test',
  groupId: '12', lobbyId: '1', memberChannelId: '2' };
const code = 'ABC1234DEF';
const start = 1800000000000;
const guestPermissions = Object.entries(GUEST_LIMITS).map(([permsid, permvalue]) =>
  ({ permsid, permvalue: String(permvalue), permnegated: '1', permskip: '1' }));
const memberPermissions = [
  { permsid: 'i_channel_join_power', permvalue: '50' }, { permsid: 'i_client_talk_power', permvalue: '50' },
  { permsid: 'b_client_modify_own_description', permvalue: '1' },
];
function fixture(overrides = {}, lookupRoster = id => id === steamId ? { name: 'Test Üye' } : null) {
  let clock = start;
  const replies = {
    serverinfo: [{ virtualserver_flag_password: '0', virtualserver_default_server_group: '8' }],
    servergrouplist: [{ sgid: '12', type: '1', name: GROUP_NAME }],
    servergrouppermlist: params => params.sgid === '12' ? memberPermissions : guestPermissions,
    channellist: [{ cid: '1', channel_flag_default: '1' }, { cid: '2', channel_flag_default: '0' }],
    channelpermlist: params => [{ permsid: 'i_channel_needed_join_power', permvalue: params.cid === '1' ? '-1' : '0' }],
    customsearch: [], custominfo: [], servergroupsbyclientid: [], clientlist: [], ...overrides,
  };
  const query = { close: jest.fn(), command: jest.fn(async (name, params) => {
    const value = replies[name]; return typeof value === 'function' ? value(params) : value || [];
  }) };
  const openQuery = jest.fn(async () => query);
  return { service: createTeamSpeak({ config, openQuery, lookupRoster, now: () => clock, randomCode: () => code }),
    query, replies, openQuery, advance: ms => { clock += ms; } };
}
function clientFor(connection, identity = 'native-private-identity-owner', dbId = '34') {
  return { client_type: '0', client_nickname: new URL(connection.url).searchParams.get('nickname'), cid: '1',
    clid: '8', client_database_id: dbId, client_unique_identifier: identity, client_servergroups: '8' };
}
async function sentCode(f) {
  const connection = await f.service.prepare(steamId, deviceId);
  f.replies.clientlist = [clientFor(connection)];
  const state = await f.service.status(steamId, deviceId, connection.requestId);
  expect(state.state).toBe('code_sent');
  return connection;
}
function noSecrets(value) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(code);
  const url = new URL(value.url);
  expect(url.searchParams.has('token')).toBe(false);
  expect(url.searchParams.has('password')).toBe(false);
}
test('first join is a key-free lobby link; nickname and marker grant no permissions', async () => {
  const f = fixture();
  const result = await f.service.prepare(steamId, deviceId);
  expect(result.state).toBe('waiting');
  expect(result.expiresAt).toBe(start + PROOF_MS);
  expect(new URL(result.url).searchParams.get('cid')).toBe('1');
  expect(new URL(result.url).searchParams.has('addbookmark')).toBe(false);
  noSecrets(result);
  expect(f.query.command.mock.calls.some(([name]) => ['tokenadd', 'servergroupaddclient', 'customset'].includes(name))).toBe(false);
});
test('repeated preparation reuses a bounded pending verification instead of changing its marker', async () => {
  const f = fixture();
  const first = await f.service.prepare(steamId, deviceId);
  expect(await f.service.prepare(steamId, deviceId)).toEqual(first);
  f.advance(PROOF_MS + 1);
  expect((await f.service.prepare(steamId, deviceId)).requestId).not.toBe(first.requestId);
});
test('the private code is sent only to the matching native client in the verification lobby', async () => {
  const f = fixture();
  const connection = await sentCode(f);
  const message = f.query.command.mock.calls.find(([name]) => name === 'sendtextmessage');
  expect(message[1]).toMatchObject({ targetmode: 1, target: '8' });
  expect(message[1].msg).toContain(code);
  noSecrets(await f.service.status(steamId, deviceId, connection.requestId));
  expect(f.query.command.mock.calls.filter(([name]) => name === 'sendtextmessage')).toHaveLength(1);
  expect(f.query.command.mock.calls.some(([name]) => name === 'servergroupaddclient')).toBe(false);
});
test.each(['different-name', 'different-channel', 'query-client', 'duplicate-nickname'])('a %s cannot get matched for proof delivery', async kind => {
  const f = fixture();
  const connection = await f.service.prepare(steamId, deviceId);
  const client = clientFor(connection);
  if (kind === 'different-name') client.client_nickname = 'spoofed roster name';
  if (kind === 'different-channel') client.cid = '2';
  if (kind === 'query-client') client.client_type = '1';
  f.replies.clientlist = kind === 'duplicate-nickname' ? [client, { ...client, clid: '9' }] : [client];
  expect((await f.service.status(steamId, deviceId, connection.requestId)).state).toBe('waiting');
  expect(f.query.command.mock.calls.some(([name]) => name === 'sendtextmessage')).toBe(false);
});
test('only a correct private code binds the Steam identity and grants the dedicated member group', async () => {
  const f = fixture();
  const connection = await sentCode(f);
  const result = await f.service.verify(steamId, deviceId, connection.requestId, code);
  expect(result.state).toBe('verified'); noSecrets(result);
  expect(new URL(result.url).searchParams.get('nickname')).toBe('Test Üye');
  expect(new URL(result.url).searchParams.get('cid')).toBe('2');
  expect(f.query.command).toHaveBeenCalledWith('customset', { cldbid: '34', ident: 'csbatagi_steam_id', value: steamId });
  expect(f.query.command).toHaveBeenCalledWith('customset', { cldbid: '34', ident: 'csbatagi_device', value: deviceId });
  expect(f.query.command).toHaveBeenCalledWith('servergroupaddclient', { sgid: '12', cldbid: '34' });
  expect(f.query.command).toHaveBeenCalledWith('clientmove', { clid: '8', cid: '2' });
  const calls = f.query.command.mock.calls.map(([name]) => name);
  expect(calls.lastIndexOf('customset')).toBeLessThan(calls.indexOf('servergroupaddclient'));
  await expect(f.service.verify(steamId, deviceId, connection.requestId, code)).rejects.toThrow('expired');
});
test('five failed guesses invalidate the proof and never grant access', async () => {
  const f = fixture(); const connection = await sentCode(f);
  for (let n = 0; n < 5; n++) await expect(f.service.verify(steamId, deviceId, connection.requestId, '0000000000')).rejects.toThrow('Incorrect');
  await expect(f.service.verify(steamId, deviceId, connection.requestId, code)).rejects.toThrow('expired');
  expect(f.query.command.mock.calls.some(([name]) => ['customset', 'servergroupaddclient'].includes(name))).toBe(false);
});
test.each(['other-steam', 'other-device', 'expired', 'not-sent'])('a %s proof cannot grant membership', async reason => {
  const f = fixture();
  const connection = reason === 'not-sent' ? await f.service.prepare(steamId, deviceId) : await sentCode(f);
  if (reason === 'expired') f.advance(PROOF_MS + 1);
  await expect(f.service.verify(reason === 'other-steam' ? '76561198000000002' : steamId,
    reason === 'other-device' ? otherId : deviceId, connection.requestId, code)).rejects.toThrow();
  expect(f.query.command.mock.calls.some(([name]) => name === 'servergroupaddclient')).toBe(false);
});
test.each(['disconnected', 'reused-database-id', 'different-owner'])('a %s native identity cannot be silently replaced', async reason => {
  const f = fixture(); const connection = await sentCode(f);
  if (reason === 'disconnected') f.replies.clientlist = [];
  if (reason === 'reused-database-id') f.replies.clientlist = [clientFor(connection, 'attacker-different-identity')];
  if (reason === 'different-owner') f.replies.custominfo = [{ ident: 'csbatagi_steam_id', value: '76561198000000002' }];
  await expect(f.service.verify(steamId, deviceId, connection.requestId, code)).rejects.toThrow();
  expect(f.query.command.mock.calls.some(([name]) => name === 'servergroupaddclient')).toBe(false);
});
test('an already-owned client is rejected before a private message can be sent', async () => {
  const f = fixture(); const connection = await f.service.prepare(steamId, deviceId);
  f.replies.clientlist = [clientFor(connection)];
  f.replies.custominfo = [{ ident: 'csbatagi_steam_id', value: '76561198000000002' }];
  await expect(f.service.status(steamId, deviceId, connection.requestId)).rejects.toThrow('already linked');
  expect(f.query.command.mock.calls.some(([name]) => name === 'sendtextmessage')).toBe(false);
});
test('returning browser markers require server-proven Steam ownership and current group membership', async () => {
  const f = fixture({ customsearch: [{ cldbid: '34' }], custominfo: [{ ident: 'csbatagi_steam_id', value: steamId }],
    servergroupsbyclientid: [{ sgid: '12' }] });
  const result = await f.service.prepare(steamId, deviceId);
  expect(result.state).toBe('verified'); noSecrets(result);
  expect((await f.service.prepare(steamId, deviceId, true)).state).toBe('waiting');
  f.replies.custominfo = [{ ident: 'csbatagi_steam_id', value: '76561198000000002' }];
  expect((await f.service.prepare(steamId, otherId)).state).toBe('waiting');
});
test('ownership-write failure cannot create an untracked member', async () => {
  const f = fixture(); const connection = await sentCode(f);
  f.replies.customset = () => { throw new Error('unavailable'); };
  await expect(f.service.verify(steamId, deviceId, connection.requestId, code)).rejects.toThrow();
  expect(f.query.command.mock.calls.some(([name]) => name === 'servergroupaddclient')).toBe(false);
});
test('roster removal revokes the member group and kicks all active linked clients', async () => {
  const f = fixture({ customsearch: [{ cldbid: '34', value: '76561198000000002' }],
    servergroupsbyclientid: [{ sgid: '12' }], clientlist: [{ ...clientFor({ url: 'ts3server://x?nickname=x' }), client_servergroups: '12' }] });
  await f.service.maintain();
  expect(f.query.command).toHaveBeenCalledWith('servergroupdelclient', { sgid: '12', cldbid: '34' });
  expect(f.query.command).toHaveBeenCalledWith('clientkick', expect.objectContaining({ clid: '8', reasonid: 5 }));
});
test('unverified idle guests are removed after the verification window; active member clients are retained', async () => {
  const f = fixture({ clientlist: [clientFor({ url: 'ts3server://x?nickname=x' })] });
  await f.service.maintain(); f.advance(PROOF_MS); await f.service.maintain();
  expect(f.query.command).toHaveBeenCalledWith('clientkick', expect.objectContaining({ clid: '8' }));
});
test('roster outage fails closed without guessing revocations', async () => {
  const f = fixture({ customsearch: [{ cldbid: '34', value: steamId }] }, () => { throw new Error('unreadable'); });
  await expect(f.service.maintain()).rejects.toThrow('unreadable');
  expect(f.query.command.mock.calls.some(([name]) => ['servergroupdelclient', 'servergroupaddclient'].includes(name))).toBe(false);
});
test.each([
  { serverinfo: [{ virtualserver_flag_password: '1', virtualserver_default_server_group: '8' }] },
  { servergrouplist: [{ sgid: '12', name: 'Server Admin', type: '1' }] },
  { channellist: [{ cid: '1', channel_flag_default: '0' }, { cid: '2', channel_flag_default: '1' }] },
  { servergrouppermlist: params => params.sgid === '8' ? guestPermissions.filter(p => p.permsid !== 'i_channel_join_power') : memberPermissions },
  { servergrouppermlist: params => params.sgid === '8' ? guestPermissions : [...memberPermissions, { permsid: 'i_permission_modify_power', permvalue: '75' }] },
  { channelpermlist: [{ permsid: 'i_channel_needed_join_power', permvalue: '-1' }] },
])('unsafe guest, channel or member-group configuration fails closed', async overrides => {
  const f = fixture(overrides);
  await expect(f.service.prepare(steamId, deviceId)).rejects.toThrow();
  expect(f.query.command.mock.calls.some(([name]) => name === 'servergroupaddclient')).toBe(false);
  expect(f.query.close).toHaveBeenCalled();
});
test('no connection is attempted without private configuration', async () => {
  const openQuery = jest.fn();
  const service = createTeamSpeak({ config: {}, openQuery });
  await expect(service.maintain()).rejects.toThrow('not configured');
  expect(openQuery).not.toHaveBeenCalled();
});
test('join URL is key-free and nickname encoding cannot inject parameters', () => {
  const url = new URL(joinUrl(config, 'Üye &token=evil\n', '2'));
  expect(url.searchParams.get('nickname')).toBe('Üye &token=evil\n');
  expect(url.searchParams.has('token')).toBe(false);
  expect(url.searchParams.has('password')).toBe(false);
});

const secret = 'test-teamspeak-session-secret';
function token(payload = {}) {
  const header = Buffer.from('{}').toString('base64url');
  const body = Buffer.from(JSON.stringify({ uid: steamId, provider: 'steam', steamId, exp: Date.now() / 1000 + 60, ...payload })).toString('base64url');
  return header + '.' + body + '.' + crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64url');
}
function appFixture(member = true, persisted = true) {
  process.env.AUTH_TOKEN = secret; process.env.MATCHMAKING_TOKEN = secret;
  const reply = async () => ({ url: 'ts3server://voice.csbatagi.com', state: 'waiting' });
  const service = { enabled: () => true, prepare: jest.fn(reply), status: jest.fn(reply), verify: jest.fn(reply) };
  const app = express(); app.use(express.json());
  const pool = { query: jest.fn(async () => ({ rows: persisted ? [{}] : [] })) };
  registerTeamSpeak(app, { pool, lookupRoster: () => member, service, startMaintenance: false });
  return { app, service, pool };
}
const validBody = { deviceId, requestId: otherId, code };
test.each(['join', 'status', 'verify'])('missing, forged, expired or non-Steam sessions cannot call %s', async action => {
  const { app, service } = appFixture();
  for (const auth of ['', token({ provider: 'google' }), token({ exp: 1 }), token() + 'tampered']) {
    await request(app).post('/teamspeak/' + action).set('Authorization', 'Bearer ' + secret).set('X-Game-Session', auth).send(validBody).expect(401);
  }
  expect(service.prepare).not.toHaveBeenCalled(); expect(service.status).not.toHaveBeenCalled(); expect(service.verify).not.toHaveBeenCalled();
});
test.each(['join', 'status', 'verify'])('current roster and stored UID pair are required on every %s request', async action => {
  for (const [member, persisted] of [[false, true], [true, false]]) {
    const { app, service } = appFixture(member, persisted);
    await request(app).post('/teamspeak/' + action).set('Authorization', 'Bearer ' + secret).set('X-Game-Session', token()).send(validBody).expect(403);
    expect(service.prepare).not.toHaveBeenCalled(); expect(service.status).not.toHaveBeenCalled(); expect(service.verify).not.toHaveBeenCalled();
  }
});
test('browser SteamID, name and roles are ignored; responses disable caching', async () => {
  const { app, service, pool } = appFixture();
  const response = await request(app).post('/teamspeak/join').set('Authorization', 'Bearer ' + secret).set('X-Game-Session', token())
    .send({ ...validBody, steamId: '76561198000000002', name: 'Admin', isAdmin: true }).expect(200);
  expect(service.prepare).toHaveBeenCalledWith(steamId, deviceId, false);
  expect(pool.query).toHaveBeenCalledWith(expect.any(String), [steamId, steamId]);
  expect(response.headers['cache-control']).toBe('no-store');
});
test.each(['join', 'status', 'verify'])('the internal bearer credential is required on %s', async action => {
  const { app } = appFixture();
  await request(app).post('/teamspeak/' + action).set('X-Game-Session', token()).send(validBody).expect(403);
});
test.each([
  ['join', { deviceId: 'command\ninjection' }], ['join', { deviceId, reset: 'true' }],
  ['status', { deviceId, requestId: 'guessed' }], ['verify', { ...validBody, code: 'sql\ninjection' }],
])('malformed %s requests cannot reach the query service', async (action, body) => {
  const { app, service } = appFixture();
  await request(app).post('/teamspeak/' + action).set('Authorization', 'Bearer ' + secret).set('X-Game-Session', token()).send(body).expect(400);
  expect(service.prepare).not.toHaveBeenCalled(); expect(service.status).not.toHaveBeenCalled(); expect(service.verify).not.toHaveBeenCalled();
});
test('query/DB failures never echo private messages, credentials or protocol replies', async () => {
  const { app, service } = appFixture();
  service.prepare.mockRejectedValue(new Error('private query password and code ' + code));
  const response = await request(app).post('/teamspeak/join').set('Authorization', 'Bearer ' + secret).set('X-Game-Session', token()).send(validBody).expect(503);
  expect(JSON.stringify(response.body)).not.toContain(code);
  expect(JSON.stringify(response.body)).not.toContain('password');
});
test('per-member rate limiting bounds active verification polling', async () => {
  const { app } = appFixture();
  for (let n = 0; n < 30; n++) await request(app).post('/teamspeak/status').set('Authorization', 'Bearer ' + secret).set('X-Game-Session', token()).send(validBody).expect(200);
  await request(app).post('/teamspeak/status').set('Authorization', 'Bearer ' + secret).set('X-Game-Session', token()).send(validBody).expect(429);
});

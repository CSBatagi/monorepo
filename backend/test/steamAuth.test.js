const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { sessionUser, registerSteamAuthRoutes } = require('../steamAuth');
const secret = 'test-steam-session-secret';
const steamId = '76561198000000001';
function signed(payload) {
  const h = Buffer.from('{}').toString('base64url');
  const b = Buffer.from(JSON.stringify({ exp: Date.now()/1000+60, ...payload })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256',secret).update(`${h}.${b}`).digest('base64url')}`;
}
test('Steam sessions are required; legacy identity is readable only during migration', () => {
  const user = { uid: steamId, steamId, provider: 'steam' };
  expect(sessionUser(signed(user),secret)).toMatchObject(user);
  expect(sessionUser(signed(user)+'x',secret)).toBeNull();
  expect(sessionUser(signed({...user,exp:1}),secret)).toBeNull();
  expect(sessionUser(signed({...user,steamId:'123'}),secret)).toBeNull();
  const legacy = signed({uid:'old-google-id',email:'old@example.test'});
  expect(sessionUser(legacy,secret)).toBeNull();
  expect(sessionUser(legacy,secret,true)).toMatchObject({uid:'old-google-id'});
});
function setup({existing=null, linked=null, legacyUsed=false}={}) {
  process.env.AUTH_TOKEN=secret; process.env.MATCHMAKING_TOKEN=secret;
  const client={query:jest.fn(async(sql,values)=>{
    if(sql.startsWith('SELECT * FROM steam_members'))return {rows:existing?[existing]:[]};
    if(sql.startsWith('SELECT steam_id FROM cosmetic_accounts'))return {rows:linked?[{steam_id:linked}]:[]};
    if(sql.startsWith('SELECT 1 FROM steam_members'))return {rows:legacyUsed?[{}]:[]};
    if(sql.startsWith('SELECT 1 FROM admins'))return {rows:[{}]};
    if(sql.startsWith('INSERT INTO steam_members'))return {rows:[{uid:values[1],display_name:values[2],legacy_email:values[3],is_admin:values[4]}]};
    return {rows:[]};
  }),release:jest.fn()};
  const pool={connect:jest.fn().mockResolvedValue(client),query:jest.fn().mockResolvedValue({rows:[]})};
  const lookupRoster=jest.fn(id=>id===steamId?{name:'Member',steamId}:undefined);
  const app=express();app.use(express.json());registerSteamAuthRoutes(app,{pool,lookupRoster});
  const login=()=>request(app).post('/auth/steam/session').set('Authorization',`Bearer ${secret}`);
  return {app,login,pool,client,lookupRoster};
}
test('login provisioning requires a server credential and a roster SteamID', async()=>{
  const {app,login,pool}=setup();
  await request(app).post('/auth/steam/session').send({steamId}).expect(403);
  await login().send({steamId:'76561198000000002'}).expect(403);
  await login().send({steamId:'not-valid'}).expect(400);
  expect(pool.connect).not.toHaveBeenCalled();
});
test('new Steam login does not grant caller-supplied admin, UID or email',async()=>{
  const {login,client}=setup();
  const res=await login().send({steamId,name:'My Steam name',email:'admin@example.test',uid:'victim',is_admin:true}).expect(200);
  expect(res.body).toMatchObject({steamId,uid:steamId,name:'My Steam name',provider:'steam'});
  expect(client.query.mock.calls.find(([s])=>s.startsWith('INSERT INTO steam_members'))[1]).toEqual([steamId,steamId,'Member',null,false]);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});
test('valid old session preserves notification UID and current admin role on first Steam login',async()=>{
  const {login,client}=setup();
  const res=await login().set('x-legacy-session',signed({uid:'google-uid',email:'old@example.test'})).send({steamId}).expect(200);
  expect(res.body.uid).toBe('google-uid');
  expect(client.query.mock.calls.find(([s])=>s.startsWith('INSERT INTO steam_members'))[1]).toEqual([steamId,'google-uid','Member','old@example.test',true]);
});
test.each([{linked:'76561198000000002'},{legacyUsed:true}])('legacy ownership conflicts cannot move another account: %j',async options=>{
  const {login,client}=setup(options);
  const res=await login().set('x-legacy-session',signed({uid:'google-uid',email:'old@example.test'})).send({steamId}).expect(200);
  expect(res.body.uid).toBe(steamId);
  expect(client.query.mock.calls.find(([s])=>s.startsWith('INSERT INTO steam_members'))[1][4]).toBe(false);
});
test('subsequent logins keep stored identity and cannot restore a revoked admin role',async()=>{
  const {login,client}=setup({existing:{uid:'old-uid',display_name:'Member',is_admin:false}});
  const res=await login().set('x-legacy-session',signed({uid:'other-google-uid',email:'admin@example.test'})).send({steamId}).expect(200);
  expect(res.body.uid).toBe('old-uid');
  expect(client.query.mock.calls.some(([sql])=>sql.includes('FROM admins')||sql.startsWith('INSERT INTO steam_members'))).toBe(false);
});

test('renewal requires the server credential, a valid Steam session and current roster membership',async()=>{
  const {app,pool,lookupRoster}=setup();
  const user={uid:steamId,steamId,provider:'steam'};
  const refresh=token=>request(app).post('/auth/steam/refresh').set('Authorization',`Bearer ${secret}`).set('X-Game-Session',token);
  await request(app).post('/auth/steam/refresh').set('X-Game-Session',signed(user)).expect(403);
  for(const token of ['',signed(user)+'x',signed({...user,exp:1}),signed({uid:'google',email:'old@example.test'})])await refresh(token).expect(401);
  lookupRoster.mockReturnValue(undefined);
  await refresh(signed(user)).expect(403);
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.connect).not.toHaveBeenCalled();
});

test('renewal preserves the stored UID/profile and cannot provision accounts or restore admin permissions',async()=>{
  const {app,pool}=setup();
  pool.query.mockResolvedValue({rows:[{uid:'preserved-uid',display_name:'Member',avatar_url:'https://avatars.steamstatic.com/avatar.jpg'}]});
  const res=await request(app).post('/auth/steam/refresh').set('Authorization',`Bearer ${secret}`)
    .set('X-Game-Session',signed({uid:'preserved-uid',steamId,provider:'steam'})).send({uid:'victim',steamId:'76561198000000002',is_admin:true}).expect(200);
  expect(res.body).toEqual({uid:'preserved-uid',steamId,provider:'steam',name:'Member',picture:'https://avatars.steamstatic.com/avatar.jpg'});
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.query).toHaveBeenCalledWith('SELECT uid,display_name,avatar_url FROM steam_members WHERE steam_id=$1 AND uid=$2',[steamId,'preserved-uid']);
  expect(pool.connect).not.toHaveBeenCalled();
});

test('renewal fails closed for missing identities and temporary database or roster failures',async()=>{
  const {app,pool,lookupRoster}=setup();
  const refresh=()=>request(app).post('/auth/steam/refresh').set('Authorization',`Bearer ${secret}`).set('X-Game-Session',signed({uid:'wrong-uid',steamId,provider:'steam'}));
  await refresh().expect(401);
  pool.query.mockRejectedValueOnce(new Error('database unavailable'));
  await refresh().expect(503);
  lookupRoster.mockImplementation(()=>{throw new Error('roster unavailable');});
  await refresh().expect(503);
});

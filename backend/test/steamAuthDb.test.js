const {Pool}=require('pg');
const crypto=require('crypto');
const express=require('express');
const request=require('supertest');
const {STEAM_AUTH_MIGRATIONS,registerSteamAuthRoutes}=require('../steamAuth');
const {COSMETICS_MIGRATIONS}=require('../cosmeticsRoutes');
const {emptyState}=require('../cosmetics');
const {migrateSteamAdmins}=require('../migrateSteamAdmins');
const connectionString=process.env.COSMETICS_TEST_DATABASE_URL;
const suite=connectionString?describe:describe.skip;
const steamId='76561198000000001',email='admin@example.test',secret='steam-db-test-secret';
const roster=[{steamId,name:'Member'}];
suite('Steam authentication PostgreSQL migration',()=>{
  let pool,owner,schema,app;
  beforeAll(async()=>{
    if(!['127.0.0.1','localhost'].includes(new URL(connectionString).hostname))throw new Error('Disposable local database only');
    schema='steam_test_'+crypto.randomBytes(6).toString('hex');
    owner=new Pool({connectionString,max:1});await owner.query(`CREATE SCHEMA ${schema}`);
    pool=new Pool({connectionString,max:4,options:`-c search_path=${schema}`});
    for(const sql of ['CREATE TABLE admins(email TEXT PRIMARY KEY,is_admin BOOLEAN)',...STEAM_AUTH_MIGRATIONS,...COSMETICS_MIGRATIONS])await pool.query(sql);
    process.env.AUTH_TOKEN=secret;process.env.MATCHMAKING_TOKEN=secret;
    app=express();app.use(express.json());registerSteamAuthRoutes(app,{pool,lookupRoster:id=>roster.find(p=>p.steamId===id)});
  });
  beforeEach(async()=>{
    await pool.query('TRUNCATE steam_members,admins,cosmetic_accounts,cosmetic_loadouts,cosmetic_wallets CASCADE');
    await pool.query('INSERT INTO admins VALUES($1,true)',[email]);
  });
  afterAll(async()=>{await pool?.end();if(owner){await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();}});
  test('parallel first logins provision one stable non-admin identity',async()=>{
    const replies=await Promise.all(Array.from({length:4},()=>request(app).post('/auth/steam/session').set('Authorization',`Bearer ${secret}`).send({steamId})));
    expect(replies.map(r=>r.status)).toEqual([200,200,200,200]);
    expect((await pool.query('SELECT * FROM steam_members')).rows).toEqual([expect.objectContaining({steam_id:steamId,uid:steamId,is_admin:false})]);
  });
  test('equipment migration preserves state, revision and wallet; reruns do not overwrite new edits',async()=>{
    const original=emptyState();original.profiles[0].name='Old set';
    await pool.query('INSERT INTO cosmetic_accounts(email,steam_id,state,revision) VALUES($1,$2,$3,7)',[email,steamId,original]);
    await pool.query('INSERT INTO cosmetic_wallets(steam_id,tokens,xp) VALUES($1,123,900)',[steamId]);
    for(const sql of COSMETICS_MIGRATIONS)await pool.query(sql);
    expect((await pool.query('SELECT state,revision FROM cosmetic_loadouts')).rows[0]).toEqual({state:original,revision:7});
    await pool.query('UPDATE cosmetic_loadouts SET revision=8');
    for(const sql of COSMETICS_MIGRATIONS)await pool.query(sql);
    expect((await pool.query('SELECT revision FROM cosmetic_loadouts')).rows[0].revision).toBe(8);
    expect((await pool.query('SELECT tokens,xp FROM cosmetic_wallets')).rows[0]).toEqual({tokens:123,xp:900});
  });
  test('renewal matches both stored identity fields and leaves account data and roles unchanged',async()=>{
    await pool.query('INSERT INTO steam_members(steam_id,uid,display_name,is_admin) VALUES($1,$2,$3,false)',[steamId,'legacy-uid','Member']);
    const before=(await pool.query('SELECT * FROM steam_members')).rows;
    const refresh=uid=>{
      const body=Buffer.from(JSON.stringify({uid,steamId,provider:'steam',exp:Date.now()/1000+86400})).toString('base64url');
      const token=`e30.${body}.`+crypto.createHmac('sha256',secret).update(`e30.${body}`).digest('base64url');
      return request(app).post('/auth/steam/refresh').set('Authorization',`Bearer ${secret}`).set('X-Game-Session',token);
    };
    await refresh('wrong-uid').expect(401);
    const res=await refresh('legacy-uid').expect(200);
    expect(res.body).toEqual({uid:'legacy-uid',steamId,provider:'steam',name:'Member',picture:null});
    expect((await pool.query('SELECT * FROM steam_members')).rows).toEqual(before);
    await pool.query('DELETE FROM steam_members');
    await refresh('legacy-uid').expect(401);
    expect((await pool.query('SELECT * FROM steam_members')).rows).toHaveLength(0);
  });
  test('admin migration dry-run leaves no changes; apply preserves legacy notification identity',async()=>{
    const mappings=[{steamId,email,legacyUid:'old-google-id'}];
    await migrateSteamAdmins(pool,mappings,roster);
    expect((await pool.query('SELECT * FROM steam_members')).rows).toHaveLength(0);
    await migrateSteamAdmins(pool,mappings,roster,true);
    await migrateSteamAdmins(pool,mappings,roster,true);
    expect((await pool.query('SELECT uid,is_admin,legacy_email FROM steam_members')).rows).toEqual([{uid:'old-google-id',is_admin:true,legacy_email:email}]);
  });
  test('admin migration rejects non-admins and conflicting equipment links',async()=>{
    await expect(migrateSteamAdmins(pool,[{steamId,email:'other@example.test'}],roster,true)).rejects.toThrow('not a current admin');
    await pool.query('INSERT INTO cosmetic_accounts(email,steam_id,state) VALUES($1,$2,$3)',[email,'76561198000000002',emptyState()]);
    await expect(migrateSteamAdmins(pool,[{steamId,email}],roster,true)).rejects.toThrow('equipment link conflicts');
    expect((await pool.query('SELECT * FROM steam_members')).rows).toHaveLength(0);
  });
});

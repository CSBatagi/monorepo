// Exercise the actual TypeScript implementations without adding a test runtime.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
function load(relative, imports = {}) {
  const filename=path.resolve(__dirname,'../src',relative);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>imports[name]||require(name),mod,mod.exports);
  return mod.exports;
}
const {beginSteamLogin,verifySteamLogin,safeNext,STEAM_OPENID}=load('lib/steamOpenId.ts');
const origin='https://example.test',secret='local-test-secret',steamId='76561198000000001';
function assertion() {
  const login=beginSteamLogin(origin,'/ekipman',secret),url=new URL(login.url);
  const returnTo=url.searchParams.get('openid.return_to');
  const params=new URLSearchParams({state:new URL(returnTo).searchParams.get('state'),'openid.ns':'http://specs.openid.net/auth/2.0','openid.mode':'id_res','openid.op_endpoint':STEAM_OPENID,'openid.claimed_id':`https://steamcommunity.com/openid/id/${steamId}`,'openid.identity':`https://steamcommunity.com/openid/id/${steamId}`,'openid.return_to':returnTo,'openid.response_nonce':new Date().toISOString().slice(0,19)+'Znonce','openid.assoc_handle':'handle','openid.signed':'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle','openid.sig':'steam-signature'});
  return {login,params};
}
const valid=async()=>new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
test('Steam sign-in binds state to a cookie and verifies with the fixed Steam endpoint',async()=>{
  const {login,params}=assertion();
  const user=await verifySteamLogin(params,login.cookie,origin,secret,async(url,options)=>{
    assert.equal(url,STEAM_OPENID);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    assert.equal(new URLSearchParams(options.body).get('openid.mode'),'check_authentication');
    return valid();
  });
  assert.deepEqual(user,{steamId,next:'/ekipman'});
});
for(const [key,value] of [['state','wrong'],['openid.return_to','https://evil.test'],['openid.op_endpoint','https://evil.test'],['openid.identity','https://steamcommunity.com/openid/id/76561198000000002'],['openid.claimed_id','https://evil.test/76561198000000001'],['openid.mode','cancel'],['openid.signed','return_to'],['openid.response_nonce','2020-01-01T00:00:00Zold']]) {
  test(`rejects invalid ${key} before making a verification request`,async()=>{
    const {login,params}=assertion();params.set(key,value);
    await assert.rejects(()=>verifySteamLogin(params,login.cookie,origin,secret,()=>{assert.fail('must not fetch');}));
  });
}
test('rejects missing/tampered cookies, repeated parameters, origin changes and Steam rejection',async()=>{
  const {login,params}=assertion();
  await assert.rejects(()=>verifySteamLogin(params,undefined,origin,secret,valid));
  await assert.rejects(()=>verifySteamLogin(params,login.cookie+'x',origin,secret,valid));
  await assert.rejects(()=>verifySteamLogin(params,login.cookie,'https://other.test',secret,valid));
  await assert.rejects(()=>verifySteamLogin(params,login.cookie,origin,secret,async()=>new Response('is_valid:false')));
  params.append('openid.identity',params.get('openid.identity'));
  await assert.rejects(()=>verifySteamLogin(params,login.cookie,origin,secret,valid));
});
test('redirects stay on our site',()=>{
  for(const next of ['https://evil.test','//evil.test','/\\evil.test','/\nevil.test'])assert.equal(safeNext(next),'/');
  assert.equal(safeNext('/ekipman?tab=knife'),'/ekipman?tab=knife');
});
test('Node and Edge both verify Steam sessions and reject forged or legacy cookies',async()=>{
  process.env.AUTH_TOKEN=secret;process.env.MATCHMAKING_TOKEN=secret;
  const auth=load('lib/authSession.ts');
  const {middleware}=load('middleware.ts',{'next/server':{NextResponse:{next:()=>({allowed:true}),redirect:()=>({redirect:true}),json:(_,options)=>({status:options.status})}}});
  const token=auth.createSessionToken({uid:steamId,steamId,provider:'steam'});
  const req=(cookie,pathname='/ekipman',method='GET')=>({url:origin+pathname,nextUrl:new URL(origin+pathname),cookies:{get:()=>({value:cookie})},headers:new Headers({host:'example.test'}),method});
  assert.equal(auth.verifySessionToken(token).steamId,steamId);
  assert.deepEqual(await middleware(req(token)),{allowed:true});
  assert.equal(auth.verifySessionToken(token+'x'),null);
  assert.deepEqual(await middleware(req(token+'x')),{redirect:true});
  assert.deepEqual(await middleware(req(token+'x','/api/live/attendance','POST')),{status:401});
  assert.deepEqual(await middleware(req(undefined,'/api/internal/stats/prewarm','POST')),{allowed:true});
  const legacyBody=Buffer.from(JSON.stringify({uid:'old-google-id',email:'old@example.test',exp:Date.now()/1000+60})).toString('base64url');
  const legacy=`e30.${legacyBody}.`+require('node:crypto').createHmac('sha256',secret).update(`e30.${legacyBody}`).digest('base64url');
  assert.equal(auth.verifySessionToken(legacy),null);
  assert.deepEqual(await middleware(req(legacy)),{redirect:true});
  const foreign=req(token,'/api/live/attendance','POST');foreign.headers.set('origin','https://evil.test');
  assert.deepEqual(await middleware(foreign),{status:403});
});

test('callback creates a session only after Steam verification and backend roster approval',async()=>{
  process.env.SITE_ORIGIN=origin;process.env.AUTH_TOKEN=secret;process.env.MATCHMAKING_TOKEN=secret;
  const profileKey=process.env.STEAM_API_KEY;delete process.env.STEAM_API_KEY;
  const originalFetch=global.fetch;
  const auth=load('lib/authSession.ts');
  const openid=load('lib/steamOpenId.ts');
  const server=load('lib/steamLoginServer.ts');
  const {GET}=load('app/api/auth/steam/callback/route.ts',{'@/lib/authSession':auth,'@/lib/steamOpenId':openid,'@/lib/steamLoginServer':server});
  const {NextRequest}=require('next/server');
  try {
    for(const allowed of [true,false]) {
      const {login,params}=assertion();const calls=[];
      global.fetch=async(url,options)=>{
        calls.push(url);
        if(url===STEAM_OPENID)return valid();
        assert.equal(JSON.parse(options.body).steamId,steamId);
        assert.equal(options.headers['X-Legacy-Session'],'old-session-for-backend-verification');
        return Response.json(allowed?{uid:'preserved-notification-id',steamId,provider:'steam',name:'Üye'}:{error:'not_member'},{status:allowed?200:403});
      };
      const req=new NextRequest(origin+'/api/auth/steam/callback?'+params,{headers:{cookie:`${openid.STEAM_LOGIN_COOKIE}=${login.cookie}; ${auth.SESSION_COOKIE_NAME}=old-session-for-backend-verification`}});
      const response=await GET(req);
      assert.equal(calls.length,2);
      assert.equal(response.cookies.get(openid.STEAM_LOGIN_COOKIE).value,'');
      if(allowed){
        const user=auth.verifySessionToken(response.cookies.get(auth.SESSION_COOKIE_NAME).value);
        assert.equal(user.steamId,steamId);assert.equal(user.uid,'preserved-notification-id');assert.equal(user.name,'Üye');
        assert.ok(Math.abs(user.exp - Date.now()/1000 - 30*86400) < 2);
        assert.equal(response.cookies.get(auth.SESSION_COOKIE_NAME).maxAge,30*86400);
        assert.equal(response.headers.get('location'),origin+'/ekipman');
      }else{
        assert.equal(response.cookies.get(auth.SESSION_COOKIE_NAME),undefined);
        assert.equal(response.headers.get('location'),origin+'/login?error=not_member');
      }
    }
  }finally{global.fetch=originalFetch;if(profileKey)process.env.STEAM_API_KEY=profileKey;delete process.env.SITE_ORIGIN;}
});

function sessionToken(payload) {
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `e30.${body}.`+require('node:crypto').createHmac('sha256',secret).update(`e30.${body}`).digest('base64url');
}

test('renewal upgrades an existing five-day session to 30 days without contacting Steam',async()=>{
  process.env.SITE_ORIGIN=origin;process.env.AUTH_TOKEN=secret;process.env.MATCHMAKING_TOKEN=secret;
  const auth=load('lib/authSession.ts'),server=load('lib/steamLoginServer.ts');
  const {POST}=load('app/api/session/refresh/route.ts',{'@/lib/authSession':auth,'@/lib/steamLoginServer':server});
  const {NextRequest}=require('next/server');
  const member={uid:'preserved-uid',steamId,provider:'steam',name:'Üye',picture:null};
  const token=sessionToken({...member,exp:Math.floor(Date.now()/1000)+5*86400});
  const originalFetch=global.fetch;
  try {
    let calls=0;
    global.fetch=async(url,options)=>{
      calls++;assert.ok(url.endsWith('/auth/steam/refresh'));
      assert.equal(options.headers['X-Game-Session'],token);
      assert.equal(options.headers.Authorization,`Bearer ${secret}`);
      assert.equal(options.cache,'no-store');
      return Response.json(member);
    };
    const res=await POST(new NextRequest(origin+'/api/session/refresh',{method:'POST',headers:{origin,cookie:`${auth.SESSION_COOKIE_NAME}=${token}`}}));
    assert.equal(res.status,200);assert.equal(calls,1);assert.equal(res.headers.get('cache-control'),'no-store');
    const cookie=res.cookies.get(auth.SESSION_COOKIE_NAME),user=auth.verifySessionToken(cookie.value);
    assert.equal(user.uid,member.uid);assert.equal(user.steamId,steamId);assert.equal(user.name,'Üye');
    assert.ok(Math.abs(user.exp-Date.now()/1000-30*86400)<2);
    assert.equal(cookie.maxAge,30*86400);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'lax');assert.equal(cookie.path,'/');
  }finally{global.fetch=originalFetch;delete process.env.SITE_ORIGIN;}
});

test('renewal rejects expired/forged/Google sessions and cross-site requests before backend calls',async()=>{
  process.env.SITE_ORIGIN=origin;
  const auth=load('lib/authSession.ts');
  const {POST}=load('app/api/session/refresh/route.ts',{'@/lib/authSession':auth,'@/lib/steamLoginServer':load('lib/steamLoginServer.ts')});
  const {NextRequest}=require('next/server');
  const originalFetch=global.fetch;
  const user={uid:steamId,steamId,provider:'steam',exp:Date.now()/1000+60};
  try {
    global.fetch=()=>assert.fail('invalid requests must not fetch');
    for(const token of ['',sessionToken(user)+'x',sessionToken({...user,exp:1}),sessionToken({uid:'google',email:'old@example.test',exp:Date.now()/1000+60})]){
      const res=await POST(new NextRequest(origin+'/api/session/refresh',{method:'POST',headers:{origin,cookie:`${auth.SESSION_COOKIE_NAME}=${token}`}}));
      assert.equal(res.status,401);assert.equal(res.headers.get('set-cookie'),null);
    }
    for(const source of ['https://evil.test','']){
      const res=await POST(new NextRequest(origin+'/api/session/refresh',{method:'POST',headers:{origin:source,cookie:`${auth.SESSION_COOKIE_NAME}=${sessionToken(user)}`}}));
      assert.equal(res.status,403);assert.equal(res.headers.get('set-cookie'),null);
    }
  }finally{global.fetch=originalFetch;delete process.env.SITE_ORIGIN;}
});

test('renewal never issues a cookie for rejected membership, mismatched identity or backend outages',async()=>{
  process.env.SITE_ORIGIN=origin;
  const auth=load('lib/authSession.ts');
  const {POST}=load('app/api/session/refresh/route.ts',{'@/lib/authSession':auth,'@/lib/steamLoginServer':load('lib/steamLoginServer.ts')});
  const {NextRequest}=require('next/server');
  const member={uid:steamId,steamId,provider:'steam'},token=auth.createSessionToken(member);
  const originalFetch=global.fetch;
  try {
    for(const [reply,expected] of [
      [()=>Response.json({}, {status:401}),401],[()=>Response.json({}, {status:403}),403],
      [()=>Response.json({}, {status:500}),503],[()=>{throw new Error('offline');},503],
      [()=>Response.json({...member,uid:'another-user'}),503],
      [()=>Response.json({...member,steamId:'76561198000000002'}),503],
    ]){
      global.fetch=reply;
      const res=await POST(new NextRequest(origin+'/api/session/refresh',{method:'POST',headers:{origin,cookie:`${auth.SESSION_COOKIE_NAME}=${token}`}}));
      assert.equal(res.status,expected);assert.equal(res.headers.get('set-cookie'),null);assert.equal(res.headers.get('cache-control'),'no-store');
    }
  }finally{global.fetch=originalFetch;delete process.env.SITE_ORIGIN;}
});

const {createSessionRenewal}=load('lib/sessionRenewal.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('active use renews at most every 30 minutes; idle/hidden/expired sessions never renew',async()=>{
  let time=Date.now(),exp=time/1000+5*86400,visible=false,calls=0,updated=0;
  const controller=createSessionRenewal({now:()=>time,readExpiry:()=>exp,isVisible:()=>visible,
    renew:async()=>{calls++;exp=time/1000+30*86400;return 200;},onRenewed:()=>updated++,onRejected:()=>assert.fail('unexpected rejection')});
  controller.activity();await tick();assert.equal(calls,0);
  visible=true;controller.activity();controller.activity();await tick();assert.equal(calls,1);assert.equal(updated,1);
  time+=29*60000;controller.activity();await tick();assert.equal(calls,1);
  time+=60000;controller.activity();await tick();assert.equal(calls,2);
  time+=86400*1000;await tick();assert.equal(calls,2); // Time alone triggers nothing.
  exp=time/1000-1;controller.activity();await tick();assert.equal(calls,2);
  exp=null;controller.activity();await tick();assert.equal(calls,2);
  await controller.stop();
});

test('transient failures retain the session and retry on later activity; denial stops renewal',async()=>{
  let time=Date.now(),calls=0,rejected=0;
  const controller=createSessionRenewal({now:()=>time,readExpiry:()=>time/1000+86400,isVisible:()=>true,
    renew:async()=>{calls++;if(calls===1)throw new Error('offline');return calls===2?503:403;},onRenewed:()=>assert.fail('unexpected success'),onRejected:()=>rejected++});
  controller.activity();await tick();controller.activity();await tick();assert.equal(calls,1);assert.equal(rejected,0);
  time+=60000;controller.activity();await tick();assert.equal(calls,2);assert.equal(rejected,0);
  time+=60000;controller.activity();await tick();assert.equal(rejected,1);
  time+=60000;controller.activity();await tick();assert.equal(calls,3);
  await controller.stop();
});

test('logout waits for an in-flight renewal and prevents later renewal callbacks',async()=>{
  let finish,calls=0,stopped=false;
  const controller=createSessionRenewal({readExpiry:()=>Date.now()/1000+86400,isVisible:()=>true,
    renew:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},onRenewed:()=>assert.fail('logout must win'),onRejected:()=>assert.fail('logout must win')});
  controller.activity();controller.activity();
  const stop=controller.stop().then(()=>{stopped=true;});
  await tick();assert.equal(stopped,false);assert.equal(calls,1);
  finish(200);await stop;assert.equal(stopped,true);
  controller.activity();await tick();assert.equal(calls,1);
});

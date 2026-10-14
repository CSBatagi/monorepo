const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
function load(relative, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => imports[name] || require(name), mod, mod.exports);
  return mod.exports;
}
process.env.AUTH_TOKEN = 'local-teamspeak-route-test';
process.env.MATCHMAKING_TOKEN = process.env.AUTH_TOKEN;
process.env.BACKEND_INTERNAL_URL = 'http://backend.test';
const auth = load('lib/authSession.ts');
const control = load('lib/gameControl.ts', { './authSession': auth });
const proxy = load('lib/teamSpeakControl.ts', { './gameControl': control });
const routes = Object.fromEntries(['join', 'status', 'verify'].map(action => [action,
  load('app/api/teamspeak/' + action + '/route.ts', { '@/lib/teamSpeakControl': proxy }).POST]));
const { middleware } = load('middleware.ts', { 'next/server': { NextResponse: {
  next: () => ({ allowed: true }), json: (_, options) => ({ status: options.status }), redirect: url => ({ redirect: String(url) }),
} } });
const session = auth.createSessionToken({ uid: 'test-member', steamId: '76561198000000001', provider: 'steam' });
function req({ token = session, origin = 'https://website.test', body = { deviceId: 'e3e5fb89-08f2-4dab-bb7e-8aee9cbb552f' } } = {}) {
  return { method: 'POST', url: 'https://website.test/api/teamspeak/join', nextUrl: { pathname: '/api/teamspeak/join', search: '' },
    headers: new Headers({ origin, host: 'container:3000', 'x-forwarded-host': 'website.test' }),
    cookies: { get: () => token ? { value: token } : undefined },
    json: async () => { if (body instanceof Error) throw body; return body; } };
}
const valid = { url: 'ts3server://voice.csbatagi.com?cid=2&nickname=Test', state: 'verified', expiresAt: null, requestId: null };
for (const action of Object.keys(routes)) {
  test(action + ' forwards the signed session to the fixed internal endpoint and disables caching', async () => {
    const before = global.fetch;
    try {
      global.fetch = async (url, options) => {
        assert.equal(url, 'http://backend.test/teamspeak/' + action);
        assert.equal(options.method, 'POST'); assert.equal(options.cache, 'no-store');
        assert.equal(options.headers.Authorization, 'Bearer ' + process.env.AUTH_TOKEN);
        assert.equal(options.headers['X-Game-Session'], session);
        assert.deepEqual(JSON.parse(options.body), { deviceId: 'e3e5fb89-08f2-4dab-bb7e-8aee9cbb552f' });
        return new Response(JSON.stringify(valid));
      };
      const response = await routes[action](req());
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.deepEqual(await response.json(), valid);
    } finally { global.fetch = before; }
  });
  test(action + ' rejects invalid sessions, foreign origins and malformed JSON before forwarding a credential', async () => {
    const before = global.fetch;
    try {
      global.fetch = () => { assert.fail('must not contact backend'); };
      for (const [options, status] of [[{ token: '' }, 401], [{ token: session + 'tampered' }, 401], [{ origin: 'https://foreign.test' }, 403], [{ body: new Error('bad JSON') }, 400]]) {
        assert.equal((await routes[action](req(options))).status, status);
      }
    } finally { global.fetch = before; }
  });
}
test('Edge middleware rejects invalid/foreign origins and missing sessions', async () => {
  assert.equal((await middleware(req({ origin: 'https://foreign.test' }))).status, 403);
  assert.equal((await middleware(req({ origin: 'invalid-origin' }))).status, 403);
  assert.equal((await middleware(req({ token: '' }))).status, 401);
  assert.equal((await middleware(req())).allowed, true);
});
test('accidental credential/debug fields are stripped before a response reaches the browser', async () => {
  const before = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ ...valid, queryPassword: 'private-fixture', serverPassword: 'private-fixture', proof: 'private-fixture' }));
    const response = await routes.join(req());
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), valid);
  } finally { global.fetch = before; }
});
for (const extra of ['&token=private-fixture', '&password=private-fixture', '&Token=private-fixture', '&apikey=private-fixture']) {
  test('forbidden launch parameter ' + extra.split('=')[0] + ' never reaches the browser', async () => {
    const before = global.fetch;
    try {
      global.fetch = async () => new Response(JSON.stringify({ ...valid, url: valid.url + extra }));
      const response = await routes.join(req());
      assert.equal(response.status, 502); assert.ok(!JSON.stringify(await response.json()).includes('private-fixture'));
    } finally { global.fetch = before; }
  });
}
test('backend error details cannot disclose credentials', async () => {
  const before = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ error: 'private query credential private-fixture' }), { status: 503 });
    const response = await routes.join(req());
    assert.equal(response.status, 503); assert.ok(!JSON.stringify(await response.json()).includes('private-fixture'));
    global.fetch = async () => new Response(JSON.stringify({ error: 'Kod eşleşmedi. TeamSpeak özel mesajındaki kodu kontrol et.' }), { status: 409 });
    assert.equal((await routes.verify(req())).status, 409);
  } finally { global.fetch = before; }
});

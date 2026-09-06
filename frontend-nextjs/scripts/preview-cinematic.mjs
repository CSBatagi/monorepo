import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// An explicitly invoked, loopback-only visual review. Never use this as a
// deployment entry point: it deliberately supplies a temporary preview session.
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostname = '127.0.0.1';
const port = 3002;
const origin = `http://${hostname}:${port}`;
const secret = randomBytes(32).toString('hex');
const builtPreview = process.argv.includes('--production');
process.chdir(projectDir);
Object.assign(process.env, {
  NODE_ENV: builtPreview ? 'production' : 'development',
  LOCAL_DEV: 'true',
  CSBATAGI_CINEMATIC_PREVIEW: 'true',
  CSBATAGI_CINEMATIC_BUILD: builtPreview ? 'true' : 'false',
  MATCHMAKING_TOKEN: secret,
  AUTH_TOKEN: secret,
  BACKEND_INTERNAL_URL: 'http://127.0.0.1:9',
  STATS_DATA_DIR: path.join(projectDir, 'runtime-data'),
  NEXT_PUBLIC_APPS_SCRIPT_URL: '',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  STEAM_API_KEY: '',
  SERVERACPASS: '',
  VAPID_PUBLIC_KEY: '',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  NEXT_TELEMETRY_DISABLED: '1',
});

// Keep Next's generated TypeScript include changes out of the normal config.
const baseTsconfig = JSON.parse(await readFile(path.join(projectDir, 'tsconfig.json'), 'utf8'));
await writeFile(path.join(projectDir, 'tsconfig.cinematic-preview.json'), `${JSON.stringify({
  ...baseTsconfig,
  include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', '.next-cinematic-preview/types/**/*.ts'],
  exclude: ['node_modules', '.next'],
}, null, 2)}\n`);
await mkdir(path.join(projectDir, '.next-cinematic-preview'), { recursive: true });

const players = JSON.parse(await readFile(path.join(projectDir, 'public/data/players.json'), 'utf8'));
const attendance = Object.fromEntries(players.slice(0, 10).map((player, index) => [player.steamId, {
  name: player.name,
  status: index < 8 ? 'coming' : 'uncertain',
}]));
const allowedApiReads = new Set(['/api/stats/check', '/api/data/map_stats']);
const allowedHosts = new Set([`${hostname}:${port}`, `localhost:${port}`]);

function sessionToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // SessionContext uses atob; JSON escapes preserve this Turkish display name.
  const payload = JSON.stringify({
    uid: 'local-cinematic-preview', email: null, name: 'Yerel İnceleme', picture: null,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  }).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const body = Buffer.from(payload).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function json(req, res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
}

const { default: next } = await import('next');
const app = next({ dev: !builtPreview, dir: projectDir, hostname, port });
let server;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const forceExit = setTimeout(() => process.exit(code), 5000);
  forceExit.unref();
  server?.close();
  server?.closeAllConnections();
  await app.close();
  clearTimeout(forceExit);
  process.exit(code);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  await app.prepare();
  const handle = app.getRequestHandler();
  server = createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host || '')) {
        json(req, res, 403, { error: 'This preview only accepts loopback hosts.' });
        return;
      }
      const url = new URL(req.url || '/', origin);
      // Also rejects Server Actions (POSTs to page routes), not just REST writes.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(req, res, 403, { error: 'Read-only local preview: changes are disabled.', preview: true });
        return;
      }
      const token = sessionToken();
      const cookies = (req.headers.cookie || '').split(';').filter(cookie => !cookie.trim().startsWith('csbatagi_session='));
      req.headers.cookie = [...cookies, `csbatagi_session=${token}`].filter(Boolean).join('; ');
      res.setHeader('Set-Cookie', `csbatagi_session=${token}; Path=/; SameSite=Strict`);
      res.setHeader('X-CSBatagi-Preview', 'read-only-local');
      if (url.pathname === '/api/live/attendance') {
        if (url.searchParams.get('v') === '1') {
          res.writeHead(304, { 'Cache-Control': 'no-store' });
          res.end();
        } else json(req, res, 200, { version: 1, attendance, preview: true });
        return;
      }
      if (url.pathname === '/api/admin/check') {
        json(req, res, 200, { isAdmin: false, preview: true });
        return;
      }
      if (url.pathname === '/api/notifications/subscriptions') {
        // Suppress the site's automatic push permission prompt in this review.
        json(req, res, 200, { registered: true, enabled: true, preview: true });
        return;
      }
      if (url.pathname === '/api/notifications/inbox') {
        json(req, res, 200, { notifications: [], version: 1, preview: true });
        return;
      }
      if (url.pathname === '/api/notifications/public-config') {
        json(req, res, 200, { vapidKey: null, preview: true });
        return;
      }
      if (url.pathname.startsWith('/api/') && !allowedApiReads.has(url.pathname)) {
        json(req, res, 403, { error: 'This API is unavailable in the local visual review.', preview: true });
        return;
      }
      if (url.pathname === '/' && !url.searchParams.has('ui')) {
        url.searchParams.set('ui', 'cinematic');
        res.writeHead(307, { Location: `${url.pathname}${url.search}` });
        res.end();
        return;
      }
      await handle(req, res);
    } catch (error) {
      console.error('[cinematic-preview] Request failed:', error instanceof Error ? error.message : 'Unknown error');
      if (!res.headersSent) json(req, res, 500, { error: 'Local preview request failed.' });
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolve);
  });
  console.log(`Cinematic review: ${origin}/?ui=cinematic`);
  console.log('Read-only. Attendance is an explicitly labelled sample; statistics use local runtime JSON.');
  console.log('Ctrl+C stops the preview. The normal .next build is separate.');
} catch (error) {
  console.error('[cinematic-preview] Startup failed:', error instanceof Error ? error.message : 'Unknown error');
  await shutdown(1);
}

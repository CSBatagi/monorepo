'use strict';
// Starts the game VM when an admin asks for a demo analysis, and closes it again once it sits idle.
//
// The CS Demo Manager CLI and the analyzer worker live on the game VM (cs2-server), so an analysis
// only runs while that VM is on. "Analiz et" starts a stopped VM and marks the run as an analysis
// session. During such a session a watcher checks once a minute and stops the VM after it has been
// idle for DEMO_ANALYSIS_IDLE_MINUTES (15) in a row: nothing queued or analyzing, no human on the
// server, no match or recording, no demo upload in flight. When it cannot confirm the server is
// empty it keeps waiting. A VM someone opened for a match ("Server Aç") is never stopped from here.

const STATUS_CACHE_MS = 15 * 1000;
const WORKER_FRESH_MS = 3 * 60 * 1000;   // a worker report this recent describes the game server
const WORKER_ALIVE_MS = 10 * 60 * 1000;  // queued work only holds the VM while the worker checks in
const BOOT_GRACE_MS = 20 * 60 * 1000;    // ...or while the VM is still starting up
const START_GRACE_MS = 3 * 60 * 1000;    // a fresh start may still read as stopped for a moment
const TICK_MS = 60 * 1000;

const COLUMNS = ['auto_stop', 'start_pending', 'started_at', 'started_by', 'running_seen_at', 'idle_since', 'busy_reason', 'last_event', 'stopped_at', 'stopped_by'];
const DEFAULTS = Object.fromEntries(COLUMNS.map(column => [column, ['auto_stop', 'start_pending'].includes(column) ? false : null]));

const BUSY_TEXT = {
  analyzing: 'Demo analizi sürüyor.',
  queued: 'Sırada analiz bekleyen demo var.',
  match: 'Sunucuda maç oynanıyor.',
  players: 'Sunucuda oyuncu var.',
  uploads: 'Maç demosu arşive yükleniyor.',
  unverified: 'Sunucunun boş olduğu doğrulanamadı.',
};

class ServerBusy extends Error {
  constructor(reason) {
    super(BUSY_TEXT[reason] || reason);
    this.reason = reason;
  }
}

const idleSetting = () => {
  const minutes = Number(process.env.DEMO_ANALYSIS_IDLE_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 15) * 60 * 1000;
};
const autoStartEnabled = () => process.env.DEMO_ANALYSIS_AUTOSTART !== 'false';

function phaseOf(status) {
  switch (status) {
    case 'RUNNING': return 'running';
    case 'PROVISIONING': case 'STAGING': case 'REPAIRING': return 'starting';
    case 'STOPPING': case 'SUSPENDING': return 'stopping';
    case 'TERMINATED': case 'STOPPED': return 'stopped';
    default: return 'unknown';
  }
}

// Session state in one database row, so a backend restart does not reset the idle clock.
function pgStore(pool) {
  return {
    async load() {
      const row = (await pool.query('SELECT * FROM analysis_server WHERE id = 1')).rows[0];
      return { ...DEFAULTS, ...row };
    },
    async save(patch) {
      const keys = Object.keys(patch).filter(key => COLUMNS.includes(key));
      if (!keys.length) return;
      await pool.query(
        `INSERT INTO analysis_server (id, ${keys.join(', ')}) VALUES (1, ${keys.map((_, index) => `$${index + 1}`).join(', ')})
         ON CONFLICT (id) DO UPDATE SET ${keys.map(key => `${key} = EXCLUDED.${key}`).join(', ')}, updated_at = NOW()`,
        keys.map(key => patch[key]));
    },
    async jobCounts() {
      return (await pool.query(
        `SELECT COUNT(*) FILTER (WHERE analysis_state = 'queued')::int AS queued, COUNT(*) FILTER (WHERE analysis_state = 'analyzing')::int AS analyzing
         FROM demo_files`)).rows[0] || { queued: 0, analyzing: 0 };
    },
  };
}

function createAnalysisServer({ pool, store = pgStore(pool), gcp, rcon, now = () => Date.now(), idleMs = idleSetting() }) {
  let cached = null;
  let worker = { at: 0, game: null };
  let starting = null;
  let ticking = null;
  let timer = null;
  const at = time => (time ? new Date(time).getTime() : null);

  async function vmStatus(fresh) {
    if (!fresh && cached && now() - cached.at < STATUS_CACHE_MS) return cached.status;
    const status = await gcp.getStatus();
    cached = { status, at: now() };
    return status;
  }

  // What the game server says about itself: RCON first, the worker's copy of status.json second.
  async function gameState() {
    try {
      const status = await rcon.status();
      const uploadsFresh = status.uploads && now() / 1000 - Number(status.uploads.updatedAt || 0) < 120;
      return {
        match: Boolean(status.live || status.preparing || status.recording),
        humans: Number(status.humans) || 0,
        uploads: uploadsFresh ? Number(status.uploads.pending) || 0 : 0,
      };
    } catch { /* CS2 still booting, stopped, or RCON unreachable */ }
    if (worker.game && now() - worker.at < WORKER_FRESH_MS) {
      // A stale status file means CS2 itself is not running, so nobody can be playing.
      if (!worker.game.running) return { match: false, humans: 0, uploads: 0 };
      return { match: Boolean(worker.game.live || worker.game.preparing || worker.game.recording), humans: Number(worker.game.humans) || 0, uploads: 0 };
    }
    return null;
  }

  async function busyReason(state, { strict = false } = {}) {
    const { queued, analyzing } = await store.jobCounts();
    if (analyzing > 0) return 'analyzing';
    if (queued > 0) {
      const workerAlive = now() - worker.at < WORKER_ALIVE_MS;
      const booting = state.started_at && now() - at(state.started_at) < BOOT_GRACE_MS;
      // A worker that never checks in must not keep the VM up forever; the jobs stay queued.
      if (strict || workerAlive || booting) return 'queued';
    }
    const game = await gameState();
    if (!game) return 'unverified';
    if (game.match) return 'match';
    if (game.humans > 0) return 'players';
    if (game.uploads > 0) return 'uploads';
    return null;
  }

  async function startVm(steamId) {
    await store.save({ auto_stop: true, start_pending: false, started_at: new Date(now()), started_by: steamId || null, running_seen_at: null,
      idle_since: null, busy_reason: null, last_event: 'started' });
    cached = { status: 'STAGING', at: now() };
    if (!starting) {
      // Starting takes a minute; the request that asked for it does not wait.
      starting = Promise.resolve()
        .then(() => gcp.startVm())
        .then(result => { if (!result || !result.success) throw new Error(result?.error || 'start failed'); })
        .catch(async error => {
          console.error('[analysis-server] start failed:', error.message);
          await store.save({ auto_stop: false, last_event: 'start_failed' }).catch(() => {});
        })
        .finally(() => { starting = null; cached = null; });
    }
  }

  async function stopVm(by) {
    await rcon.executeCommand('quit').catch(() => {});
    const result = await gcp.stopVm();
    cached = null;
    if (!result || !result.success) throw new Error(result?.error || 'stop failed');
    await store.save({ auto_stop: false, start_pending: false, idle_since: null, busy_reason: null, stopped_at: new Date(now()), stopped_by: by,
      last_event: by === 'auto' ? 'auto_stopped' : 'stopped' });
    console.log(`[analysis-server] game VM stopped by ${by}`);
  }

  return {
    // Called after an admin queues an analysis, or presses "Sunucuyu aç".
    async ensureRunning(steamId) {
      const status = await vmStatus(true);
      const phase = phaseOf(status);
      if (!autoStartEnabled()) return { vm: phase, started: false };
      if (phase === 'stopped') {
        await startVm(steamId);
        return { vm: 'starting', started: true };
      }
      if (phase === 'stopping') {
        await store.save({ start_pending: true, started_by: steamId || null, last_event: 'start_pending' });
        return { vm: 'stopping', started: false, pending: true };
      }
      // Already on (or booting): new work restarts the idle clock of an analysis session.
      await store.save({ idle_since: null });
      return { vm: phase, started: false };
    },

    // One pass of the idle watcher; returns what it decided, for logs and tests.
    async tick() {
      const state = await store.load();
      if (!state.auto_stop && !state.start_pending) return 'inactive';
      const phase = phaseOf(await vmStatus(true));
      if (phase === 'stopped') {
        if (starting || (state.started_at && !state.running_seen_at && now() - at(state.started_at) < START_GRACE_MS)) return 'waiting';
        if (state.start_pending) {
          await startVm(state.started_by);
          return 'started';
        }
        // Closed elsewhere (Server Kapat, the console) or it never came up: the session is over.
        await store.save({ auto_stop: false, idle_since: null, busy_reason: null, last_event: state.running_seen_at ? 'stopped_elsewhere' : 'start_failed' });
        return 'ended';
      }
      if (phase !== 'running') return 'waiting';
      if (!state.running_seen_at || state.start_pending) await store.save({ running_seen_at: state.running_seen_at || new Date(now()), start_pending: false });
      if (!state.auto_stop) return 'inactive';
      const reason = await busyReason(state);
      if (reason) {
        if (state.idle_since || state.busy_reason !== reason) await store.save({ idle_since: null, busy_reason: reason });
        return reason;
      }
      if (!state.idle_since) {
        await store.save({ idle_since: new Date(now()), busy_reason: null });
        return 'idle';
      }
      if (now() - at(state.idle_since) < idleMs) return 'idle';
      await stopVm('auto');
      return 'stopped';
    },

    // "Sunucuyu kapat" on the Demolar page.
    async stopNow(steamId) {
      const phase = phaseOf(await vmStatus(true));
      if (phase === 'stopped') return { vm: 'stopped', stopped: false };
      if (phase !== 'running') throw new ServerBusy('Sunucu şu anda açılıyor ya da kapanıyor; birazdan tekrar deneyin.');
      const reason = await busyReason(await store.load(), { strict: true });
      if (reason) throw new ServerBusy(reason);
      await stopVm(steamId || 'admin');
      return { vm: 'stopped', stopped: true };
    },

    // Someone opened the server for a match: it is no longer an analysis session.
    async noteManualStart() {
      cached = null;
      await store.save({ auto_stop: false, start_pending: false, idle_since: null, busy_reason: null, last_event: 'manual_start' });
    },
    async noteManualStop(steamId) {
      cached = null;
      await store.save({ auto_stop: false, start_pending: false, idle_since: null, busy_reason: null, stopped_at: new Date(now()), stopped_by: steamId || 'member', last_event: 'stopped' });
    },
    async analysisRunning() {
      return (await store.jobCounts()).analyzing > 0;
    },
    noteWorker(report) {
      const game = report && typeof report.game === 'object' && report.game ? report.game : null;
      worker = {
        at: now(),
        game: game && {
          running: game.running === true, humans: Number(game.humans) || 0,
          live: game.live === true, preparing: game.preparing === true, recording: game.recording === true,
        },
      };
    },

    async snapshot() {
      const state = await store.load();
      let status = 'UNKNOWN';
      try {
        status = await Promise.race([vmStatus(false), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000).unref?.())]);
      } catch { /* shown as unknown */ }
      const idleSince = at(state.idle_since);
      return {
        vm: phaseOf(status),
        autoStart: autoStartEnabled(),
        autoStop: Boolean(state.auto_stop),
        startPending: Boolean(state.start_pending),
        idleMinutes: Math.round(idleMs / 60000),
        idleSince: idleSince ? new Date(idleSince).toISOString() : null,
        stopAt: idleSince ? new Date(idleSince + idleMs).toISOString() : null,
        busy: state.busy_reason ? { reason: state.busy_reason, text: BUSY_TEXT[state.busy_reason] || null } : null,
        lastEvent: state.last_event,
        stoppedAt: state.stopped_at ? new Date(state.stopped_at).toISOString() : null,
        stoppedAutomatically: state.stopped_by === 'auto',
      };
    },

    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (ticking) return;
        ticking = this.tick()
          .then(result => { if (!['inactive', 'idle', 'waiting'].includes(result)) console.log(`[analysis-server] ${result}`); })
          .catch(error => console.warn('[analysis-server] check failed:', error.message))
          .finally(() => { ticking = null; });
      }, TICK_MS);
      timer.unref?.();
    },
    // Tests await the background start.
    settled: () => starting || Promise.resolve(),
  };
}

const ANALYSIS_SERVER_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS analysis_server (
     id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     auto_stop BOOLEAN NOT NULL DEFAULT false,
     start_pending BOOLEAN NOT NULL DEFAULT false,
     started_at TIMESTAMPTZ,
     started_by TEXT,
     running_seen_at TIMESTAMPTZ,
     idle_since TIMESTAMPTZ,
     busy_reason TEXT,
     last_event TEXT,
     stopped_at TIMESTAMPTZ,
     stopped_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
];

module.exports = { createAnalysisServer, pgStore, phaseOf, ServerBusy, BUSY_TEXT, ANALYSIS_SERVER_MIGRATIONS };

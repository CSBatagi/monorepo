# Performance Optimization Report - CS Batagi Platform

## Overview

The platform runs on a **1 GB RAM GCP VM** with 5 Docker containers (ddns, backend, frontend-nextjs, postgres, caddy). This report documents the optimizations implemented to make this work reliably.

## Architecture

```
Internet -> Caddy (reverse proxy, TLS, gzip/zstd)
         -> frontend-nextjs (Next.js 15, ISR, HMAC sessions)
         -> backend (Express, stats generation)
         -> postgres (DB, tuned for low memory)
         -> ddns (Cloudflare DDNS)
```

## Estimated Memory Budget (After Optimizations)

| Service | Estimate | Docker Limit |
|---------|----------|--------------|
| PostgreSQL | ~100-120 MB | 192M |
| Backend (Node.js) | ~80-120 MB | 256M |
| Frontend (Next.js) | ~120-180 MB | 256M |
| Caddy | ~20-30 MB | — |
| DDNS | ~10 MB | — |
| Docker overhead | ~50 MB | — |
| **Total** | **~400-510 MB** | — |

Leaves ~490-600 MB headroom (including OS).

## Implemented Optimizations

### 1. PostgreSQL Memory Tuning (docker-compose.yml)

- `shared_buffers=32MB` (down from default 128 MB)
- `work_mem=2MB`, `maintenance_work_mem=32MB`
- `max_connections=20`
- Docker memory limit: 192M

### 2. Backend Memory Reduction

- **Connection pool**: reduced from 15 to 10; idle timeout raised to 120s to keep connections alive between 60s polls (`index.js`)
- **V8 heap**: capped at 128 MB via `NODE_OPTIONS`
- **Query batching**: 11 parallel DB queries staggered into 3 batches of 3-4 (`statsGenerator.js`)
- **Period processing**: changed from `Promise.all` to sequential loop
- **In-memory stats cache**: `lastGeneratedData` (~4 MB) and `lastAggregateData` (~50-100 KB) kept permanently in memory — no TTL. Overwritten when DB timestamp changes; only null after a container restart.
- **PG buffer keepalive**: 60s poller touches `live_version` table to keep attendance pages in PG buffer cache
- Startup runs `generateAggregates` so aggregate data is available immediately
- Docker memory limit: 256M

### 3. Frontend Memory Reduction

- **HMAC session tokens** (`authSession.ts`): replaced firebase-admin in the login/session flow with lightweight HMAC-SHA256 JWT. firebase-admin no longer loads on every request.
- **V8 heap**: 128 MB (`docker-entrypoint.sh`) — firebase-admin no longer loads on startup (scheduler moved to backend)
- **Notification scheduler**: moved to the backend process (see below)
- **Lazy Firebase SDK**: `FirebaseProviders` is code-split via `next/dynamic`. Stats pages never download the Firebase client SDK (~200-400 KB JS saved).
- **SessionContext**: lightweight cookie-based user context replaces Firebase Auth in shared components (Header, Layout)
- **Incremental refresh cooldown**: 90 seconds (`layout.tsx`). JSON files written without pretty-printing.
- **Unified SSR data path**: all stats pages use `fetchStats()` (`lib/statsServer.ts`) which fetches from backend memory server-to-server (10s module cache). Falls back to disk files only when backend is unreachable. Eliminates stale-disk-read bugs where some pages showed fresh data and others didn't.
- **Duplicate firebase config**: deleted `lib/firebase.ts` (root-level duplicate with debug console.log)
- **Server-side player data**: `attendance/page.tsx` is a server component that reads `players.json` from disk (ISR, revalidate 60s). The client component (`AttendanceClient.tsx`) receives players as props — no client-side fetch waterfall.
- Docker memory limit: 256M

### 4. Caddy / Network Optimizations (Caddyfile)

- `encode gzip zstd` for all responses
- `/_next/static/*`: `Cache-Control: public, max-age=31536000, immutable`
- `/images/*`: `Cache-Control: public, max-age=86400`

### 5. API Response Caching

All `/api/data/*` routes now return `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

## Session Authentication

The login flow no longer uses firebase-admin to verify tokens. Instead:

1. Client sends Firebase ID token to `/api/session/login`
2. Server decodes the token payload (base64url), extracts `uid`, `email`, `name`
3. Server creates an HMAC-SHA256 signed session token using `MATCHMAKING_TOKEN` as secret
4. Token stored as `csbatagi_session` cookie (5-day expiry)
5. Edge middleware validates the HMAC signature and expiry on each request

This eliminates ~30-50 MB of firebase-admin memory from the request hot path.

## Notification Scheduler

The scheduler runs in the **backend** Express process (`backend/notificationScheduler.js`), not in Next.js:

- Started after the Express server is listening (`index.js`)
- Runs every 60 seconds
- firebase-admin loads in the backend process (shared memory with stats generation)
- Timed rules check Istanbul time and read attendance count from Firebase RTDB
- Stats-update check uses the backend's in-memory cached DB timestamp (zero DB/HTTP cost)
- Can be disabled via `ENABLE_NOTIFICATION_SCHEDULER=false`
- Requires Firebase credentials in the backend env (`.frontend_secrets` is shared via docker-compose)

## Remaining Optimization Opportunities

If further memory reduction is needed:

1. **Add swap space** (1-2 GB) on the VM as OOM safety net
2. **Paginate `sonmac_by_date_all.json`** (4.1 MB) — load only current season by default
3. **Re-enable Next.js image optimization** or use a CDN for static images

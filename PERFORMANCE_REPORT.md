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

- **Connection pool**: reduced from 15 to 5 (`index.js`)
- **V8 heap**: capped at 128 MB via `NODE_OPTIONS`
- **Query batching**: 11 parallel DB queries staggered into 3 batches of 3-4 (`statsGenerator.js`)
- **Period processing**: changed from `Promise.all` to sequential loop
- **Data cache TTL**: `lastGeneratedData` and `lastAggregateData` expire after 5 minutes
- **Deferred startup**: no longer runs `generateAggregates` on boot
- Docker memory limit: 256M

### 3. Frontend Memory Reduction

- **HMAC session tokens** (`authSession.ts`): replaced firebase-admin in the login/session flow with lightweight HMAC-SHA256 JWT. firebase-admin no longer loads on every request.
- **V8 heap**: 160 MB (`docker-entrypoint.sh`) — accommodates firebase-admin for the notification scheduler
- **Notification scheduler**: interval increased from 30s to 60s (`notificationScheduler.ts`)
- **Incremental refresh cooldown**: increased from 60s to 5 minutes (`layout.tsx`)
- **JSON writes**: removed pretty-printing (`JSON.stringify(data)` instead of `JSON.stringify(data, null, 2)`)
- **Duplicate firebase config**: deleted `lib/firebase.ts` (root-level duplicate with debug console.log)
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

The scheduler remains active in the Next.js process (`layout.tsx` calls `ensureNotificationSchedulerStarted()`):

- Runs every 60 seconds (was 30s)
- firebase-admin lazy-loads on first tick (~30-50 MB one-time cost)
- Handles timed reminders (attendance nudges) and stats-update notifications
- Can be disabled via `ENABLE_NOTIFICATION_SCHEDULER=false`

## Remaining Optimization Opportunities

If further memory reduction is needed:

1. **Add swap space** (1-2 GB) on the VM as OOM safety net
2. **Paginate `sonmac_by_date_all.json`** (4.1 MB) — load only current season by default
3. **Lazy-load notification components** on the client (NotificationProvider, NotificationBell)
4. **Move notification scheduler to backend** container to fully eliminate firebase-admin from the frontend process
5. **Re-enable Next.js image optimization** or use a CDN for static images

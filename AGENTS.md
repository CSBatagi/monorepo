# AGENTS.md

## Read Order

1. [`docs/README.md`](docs/README.md)
2. [`docs/development/local-setup.md`](docs/development/local-setup.md)
3. [`docs/development/stats-runtime.md`](docs/development/stats-runtime.md)
4. [`docs/operations/security-secrets.md`](docs/operations/security-secrets.md)
5. [`docs/features/steam-integration.md`](docs/features/steam-integration.md) when touching Steam avatars or profile links.

## Critical Invariants

- Season boundaries are sourced from `frontend-nextjs/public/data/season_start.json`.
- Runtime JSON persistence uses `frontend-nextjs/runtime-data/` (or `STATS_DATA_DIR`).
- Main backend stats routes are `/stats/incremental`, `/stats/force-regenerate`, `/stats/diagnostics`.
- If you add/rename a stats file, update all sync points listed in `docs/development/stats-runtime.md`.
- Session auth uses HMAC-SHA256 tokens (`authSession.ts`), NOT firebase-admin session cookies.
- Notification scheduler runs in the **backend** (`backend/notificationScheduler.js`), not in Next.js. Push delivery uses `web-push` (VAPID), not Firebase Cloud Messaging.
- The VM has 1 GB RAM. Docker memory limits are enforced (postgres 192M, backend 256M, frontend 256M). Do not add heavy dependencies or increase parallelism without checking the memory budget in `PERFORMANCE_REPORT.md`.

## Scope Rule

Keep this file short and stable. Put operational detail in `docs/` files to avoid drift.

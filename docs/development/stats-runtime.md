# Stats Runtime Architecture

## Runtime Flow

1. **SSR (server rendering)**: All stats pages call `fetchStats()` (`lib/statsServer.ts`). The helper first checks whether all requested JSON files already exist in `runtime-data/` and reads `runtime-data/stats_meta.json` (with `statsVersion` plus `serverTimestamp`). If both are present, it calls backend `GET /stats/incremental?lastKnownVersion=...`. When backend replies `{ updated: false }`, SSR serves the requested datasets directly from `runtime-data/` without pulling the full payload over the network. If the requested runtime snapshot is incomplete, unreadable, or the metadata file is missing, SSR forces a full backend payload instead of returning partial data. A 10s module-level cache still prevents repeated backend calls across concurrent SSR renders, but it is only considered a hit when it already contains **all** requested dataset keys; subset reads are merged into the cache rather than replacing it. Timeout is 15s to cover cold-start generation (10-20s on the 1 GB VM).
2. **Client refresh**: Client components use the shared `useStatsRefresh` hook (`lib/useStatsRefresh.ts`) which calls `/api/stats/check` (incremental — only returns data when `updated: true`). The hook provides `onData` (fresh data) and `onSettled` (always fires, for clearing loading state) callbacks.
3. **Disk write-through**: Root layout's `after()` hook calls `incrementalRefresh()` (cooldown: 90s) which fetches backend `GET /stats/incremental` and persists JSON files plus `stats_meta.json` to `runtime-data/` using `writeStatsSnapshot()` / `persistSnapshotMetadata()` from `lib/statsSnapshot.ts`. These files are both the backend-down fallback layer and the primary unchanged-data recall path for SSR. The runtime snapshot is a separate store from backend in-memory `lastGeneratedData`, so metadata persistence must only happen when the runtime snapshot write is complete; if the backend replies `updated: false`, or if any existing file is preserved because the incoming dataset is empty, `stats_meta.json` is intentionally **not** advanced. This is the **sole disk writer** for stats files (apart from admin manual regeneration).
4. Backend tracks source-table mutations in `stats_refresh_state` using a single `dirty` flag, `last_mutation_at`, and monotonic `current_version`.
5. Once the state stays quiet for the configured quiet window, backend regenerates datasets once, increments the published version, clears `dirty`, and pushes the completed snapshot to the frontend.
6. `/api/data/map_stats` route serves `map_stats.json` from `runtime-data/` on disk — used by team-picker. All other `/api/data/*` routes have been removed.

## Canonical Season Config

File: `frontend-nextjs/public/data/season_start.json`

Expected shape:

```json
{
  "season_start": "YYYY-MM-DD",
  "season_starts": ["YYYY-MM-DD", "..."]
}
```

- `season_start`: active season start.
- `season_starts`: all historical boundaries used for period dropdowns and all-time segmentation.

## Period-Aware Dataset Contract

Primary JSON outputs:

- `season_avg.json`
- `season_avg_periods.json`
- `last10.json`
- `night_avg.json`
- `night_avg_all.json`
- `sonmac_by_date.json`
- `sonmac_by_date_all.json`
- `players_stats.json`
- `players_stats_periods.json`
- `performance_data.json`
- `duello_son_mac.json`
- `duello_sezon.json`
- `map_stats.json`

Current usage pattern:

- Date-keyed pages use all-time datasets with client period filtering (`night_avg_all`, `sonmac_by_date_all`).
- Heavy player payload uses backend period-precomputed structure (`players_stats_periods`).
- Season average tab consumes `season_avg_periods`.

## Page to Dataset Mapping

- `season-avg`: `season_avg_periods`
- `sonmac`, `mac-sonuclari`: `sonmac_by_date_all`
- `gece-ortalama`: `night_avg_all`
- `performans-odulleri`: `night_avg_all`
- `oyuncular`: `players_stats_periods`

## Required Sync Points When Adding/Renaming Stats Files

The canonical file list lives in `frontend-nextjs/src/lib/statsSnapshot.ts` (`STAT_FILES` array). Update the following together:

- `frontend-nextjs/src/lib/statsSnapshot.ts` (single source of truth for the 13-file list + disk write helper)
- `backend/generate-stats-from-prod.js`
- `frontend-nextjs/src/lib/dataReader.ts` (disk fallback defaults)
- `frontend-nextjs/src/lib/statsServer.ts` (SSR recall path — key names must match backend dataset keys, and unchanged fast-path depends on complete `runtime-data` files + `stats_meta.json`)

## Memory Optimizations (1 GB VM)

The platform runs on a 1 GB RAM GCP VM. Key optimizations:

- **PostgreSQL**: tuned to `shared_buffers=32MB`, `work_mem=2MB`, `max_connections=20` (Docker limit: 192M).
- **Backend**: connection pool of 10 (idle timeout: 120s to survive between 60s polls), V8 heap capped at 128 MB (Docker limit: 256M). Stats queries run in staggered batches of 3-4 instead of 11 parallel. Stats cache (`lastGeneratedData` ~4 MB) kept permanently in memory — overwritten when DB data changes, only null on container restart.
- **Frontend**: V8 heap capped at 160 MB (Docker limit: 256M). Session auth uses HMAC-SHA256 tokens (`authSession.ts`) instead of firebase-admin for the hot path. firebase-admin only loads lazily for the notification scheduler and admin routes.
- **Caddy**: gzip/zstd compression enabled. Static assets (`/_next/static/*`, `/images/*`) get long-lived cache headers.
- **Incremental refresh cooldown**: 90 seconds (layout.tsx `after()` hook). JSON files written without pretty-printing.

## Diagnostics and Notes

- Main backend stats routes:
  - `GET /stats/incremental` — checks the cached published stats version (zero DB cost), returns full dataset when caller has an older `lastKnownVersion`, or `{ updated: false, statsVersion, serverTimestamp }` when unchanged.
  - `POST /stats/force-regenerate` — admin-only, clears all caches and regenerates everything
  - `GET /stats/diagnostics` — returns cached dataset sizes and season config
- Data recall rules:
  - SSR should only use `runtime-data/` as the unchanged fast path when every requested dataset file exists and parses successfully.
  - If any requested runtime file is missing or unreadable, SSR must force a full backend payload rather than mix partial runtime data with fresh backend data.
  - Backend in-memory stats and frontend `runtime-data/` are separate stores. A fresh backend timestamp does not make the runtime snapshot safe unless the corresponding runtime files were fully written.
  - Background unchanged checks (`updated: false`) do not advance the persisted runtime metadata; otherwise SSR could trust older runtime files as if they matched the latest published version.
  - If a write preserves an older runtime file because the incoming dataset is empty, the persisted metadata must remain unchanged so SSR will keep requesting a full backend payload instead of trusting a mixed-version runtime snapshot.
  - The SSR module cache is completeness-aware: it should only satisfy a request when all requested keys are already cached. Partial page-level reads may extend the cache, but must not replace unrelated cached datasets.
  - Generic disk fallback remains the last resort for backend-unavailable scenarios.
- Backend polls `stats_refresh_state` in the background and touches `live_version` to keep attendance table pages in PG buffer cache. Page loads never hit the DB directly.
- Historical (completed) season data is cached in memory and only recomputed on force-regenerate.

## Live State (Attendance + Team Picker)

Attendance and team-picker state migrated from Firebase RTDB to PostgreSQL. See `docs/FIREBASE_MIGRATION_PLAN.md`.

- **Backend routes**: `GET/POST /live/attendance`, `GET/POST /live/team-picker/*` (`liveRoutes.js`)
- **Rate limiting**: `/live/*` routes are exempt from the 30 req/min rate limiter (high-frequency polling, shared Docker IP)
- **Frontend polling**: `useLivePolling` hook polls every 3s with version-based 304 responses
  - `refetch()` resets the polling timer to avoid redundant requests after writes
- **Frontend writes**: `liveApi.ts` helpers: `updateAttendance`, `bulkUpdateAttendance`, `resetAttendance`, `resetTeamPicker`
- **Tables**: `attendance`, `team_picker`, `live_version` (auto-created via migrations in `index.js`)
- Both `/attendance` and `/team-picker` removed from `FIREBASE_ROUTES` — zero Firebase SDK on these pages
- `AttendanceClient.tsx` uses `useSession` (not `useAuth`) + `useLivePolling` + `liveApi` for all operations
- Notification emit route (`/api/notifications/emit`) reads coming count from PostgreSQL backend exclusively
- Notification emit auth: accepts HMAC session cookie (attendance) or Firebase ID token (gecenin-mvpsi)
- Teker dondu crossing state: in-memory Map (replaces Firebase RTDB transaction). Resets on deploy — acceptable trade-off

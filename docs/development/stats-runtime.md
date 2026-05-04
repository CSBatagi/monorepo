# Stats Runtime Architecture

## Runtime Flow

1. **SSR (server rendering)**: All stats pages call `fetchStats()` (`lib/statsServer.ts`). The helper first checks whether all requested JSON files already exist in `runtime-data/` and reads `runtime-data/stats_meta.json` (with `statsVersion` plus `serverTimestamp`). If both are present, it calls backend `GET /stats/incremental?lastKnownVersion=...`. When backend replies `{ updated: false }`, SSR serves the requested datasets directly from `runtime-data/` without pulling the full payload over the network. If the requested runtime snapshot is incomplete, unreadable, or the metadata file is missing, SSR forces a full backend payload instead of returning partial data. A 10s module-level cache still prevents repeated backend calls across concurrent SSR renders, but it is only considered a hit when it already contains **all** requested dataset keys; subset reads are merged into the cache rather than replacing it. Timeout is 15s to cover cold-start generation (10-20s on the 1 GB VM).
2. **Client refresh**: Client components use the shared `useStatsRefresh` hook (`lib/useStatsRefresh.ts`) which calls `/api/stats/check` (incremental — only returns data when `updated: true`). The hook keeps the global `statsVersion` model, but callers can pass dataset `keys` so the browser receives only the datasets that component can consume. The endpoint still persists the complete backend snapshot before filtering the public response. The hook provides `onData` (fresh data) and `onSettled` (always fires, for clearing loading state) callbacks.
3. **Disk write-through**: The dynamic stats check and prewarm routes fetch backend `GET /stats/incremental` and persist JSON files plus `stats_meta.json` to `runtime-data/` using `writeStatsSnapshotWithStatus()` / `persistSnapshotMetadata()` from `lib/statsSnapshot.ts`. These files are both the backend-down fallback layer and the primary unchanged-data recall path for SSR. The runtime snapshot is a separate store from backend in-memory `lastGeneratedData`, so metadata persistence must only happen when the runtime snapshot write is complete; if the backend replies `updated: false`, or if any existing file is preserved because the incoming dataset is empty, `stats_meta.json` is intentionally **not** advanced.
4. Backend tracks source-table mutations in `stats_refresh_state` using `dirty`, `last_mutation_at`, and monotonic `mutation_version`. `current_version` is the published stats snapshot version, not the pending DB mutation counter.
5. Once the state stays quiet for the configured quiet window, backend regenerates datasets once, increments the published version, clears `dirty`, and asks the frontend internal prewarm endpoint to persist the completed snapshot.
6. `/api/data/map_stats` route serves `map_stats.json` from `runtime-data/` on disk — used by team-picker. All other `/api/data/*` routes have been removed.

Production publishing details and incident checks live in [`../operations/stats-publishing.md`](../operations/stats-publishing.md). Keep that runbook in sync when changing backend dirty-state tracking, frontend prewarm, or admin regeneration behavior.

## Canonical Season Config

File: `frontend-nextjs/public/data/season_start.json`

Expected shape:

```json
{
  "season_start": "YYYY-MM-DD",
  "season_starts": ["YYYY-MM-DD"]
}
```

- `season_start`: the single global active season start for the website and backend stats generation.
- `season_starts`: optional sorted list of global season boundaries, including the active `season_start`. Backend period datasets use these to derive previous season end dates.
- Completed feature seasons that need to stay pinned independently from the global season calendar, such as Batak All-Stars, must use a dedicated feature file. Current All-Stars file: `frontend-nextjs/public/data/batak_allstars_season_start.json`.

## Period-Aware Dataset Contract

Primary JSON outputs:

- `season_avg.json`
- `season_avg_periods.json`
- `last10.json`
- `night_avg.json`
- `night_avg_periods.json`
- `sonmac_by_date.json`
- `sonmac_by_date_periods.json`
- `players_stats.json`
- `players_stats_periods.json`
- `performance_data.json`
- `duello_son_mac.json`
- `duello_sezon.json`
- `map_stats.json`

Current usage pattern:

- Date-keyed historical pages prefer small period manifests (`night_avg_periods`, `sonmac_by_date_periods`) whose `data` contains only the active/current season.
- Completed date-keyed seasons are baked into frontend static files under `public/data/stats-history/<dataset>/season_YYYY-MM-DD.json`.
- Historical and all-time browser views lazy-load static period files only when a user selects that period. All-time is assembled client-side from static completed seasons plus the active runtime season.
- Heavy player payload uses backend period-precomputed structure (`players_stats_periods`).
- Season average tab consumes `season_avg_periods`.

## Page to Dataset Mapping

- `season-avg`: `season_avg_periods`
- `sonmac`, `mac-sonuclari`: `sonmac_by_date_periods`
- `gece-ortalama`: `night_avg_periods`
- `performans-odulleri`: `night_avg_periods`
- `gecenin-mvpsi`: `night_avg_periods`
- `batak-allstars`, `token-wars`: `night_avg_periods`, `sonmac_by_date_periods`
- `oyuncular`: `players_stats_periods`

## Adding Stats Pages

When adding or modifying a stats-consuming page, keep these rules:

- Use the smallest dataset the page needs. Do not introduce merged all-time date-keyed runtime payloads for `night_avg` or `sonmac_by_date`.
- For current-season date-keyed data, request `night_avg_periods` or `sonmac_by_date_periods` and read `current_period` from the payload. These period payloads intentionally embed only active/current season data.
- For historical season selection in the browser, reuse `frontend-nextjs/src/lib/statsPeriods.ts`. It lazy-loads one committed static shard from `public/data/stats-history/<dataset>/season_YYYY-MM-DD.json`.
- For all-time date-keyed browser views, merge on demand from static completed season shards plus the active runtime period. Do not make the backend or `/api/stats/check` return a merged all-time date-keyed object by default.
- For server-rendered feature pages with custom date ranges, reuse `frontend-nextjs/src/lib/statsHistoryServer.ts` so SSR reads only the overlapping static shards.
- Add every new runtime dataset key to `frontend-nextjs/src/app/api/internal/stats/prewarm/route.ts` so ISR pages are revalidated after a stats publish.
- If a new completed global season boundary is added, regenerate production source files and rerun `cd frontend-nextjs && npm run bake-stats-history`; commit the updated files under `public/data/stats-history/`.

## Required Sync Points When Adding/Renaming Stats Files

The canonical file list lives in `frontend-nextjs/src/lib/statsSnapshot.ts` (`STAT_FILES` array). Update the following together:

- `frontend-nextjs/src/lib/statsSnapshot.ts` (single source of truth for the stats file list + disk write helper)
- `backend/generate-stats-from-prod.js`
- `frontend-nextjs/src/lib/dataReader.ts` (disk fallback defaults)
- `frontend-nextjs/src/lib/statsServer.ts` (SSR recall path — key names must match backend dataset keys, and unchanged fast-path depends on complete `runtime-data` files + `stats_meta.json`)
- `frontend-nextjs/scripts/bake-stats-history.mjs` and committed files in `frontend-nextjs/public/data/stats-history/` when completed season boundaries change or historical snapshots are regenerated.

## Memory Optimizations (1 GB VM)

The platform runs on a 1 GB RAM GCP VM. Key optimizations:

- **PostgreSQL**: tuned to `shared_buffers=32MB`, `work_mem=2MB`, `max_connections=50` (Docker limit: 192M). The higher connection ceiling is intentional operational/concurrency headroom; the backend pool itself is capped at 10.
- **Backend**: connection pool of 10 (idle timeout: 120s), V8 heap capped at 128 MB (Docker limit: 256M). Stats queries run in staggered batches of 3-4 instead of 11 parallel. Stats cache (`lastGeneratedData` ~4 MB) kept permanently in memory — overwritten when DB data changes, only null on container restart.
- **Frontend**: V8 heap capped at 192 MB (Docker limit: 256M). Session auth uses HMAC-SHA256 tokens (`authSession.ts`) instead of firebase-admin session cookies. Firebase SDKs have been removed.
- **Caddy**: gzip/zstd compression enabled. Static assets (`/_next/static/*`, `/images/*`) get long-lived cache headers.
- **Stats check cooldown**: 10 seconds per stats version. Concurrent checks for the same version share one backend request.

## Runtime Snapshot Writers

Only these paths should write generated stats into frontend `runtime-data/`:

- `frontend-nextjs/src/app/api/stats/check/route.ts` (public client refresh; deduped)
- `frontend-nextjs/src/app/api/internal/stats/prewarm/route.ts` (backend-triggered internal prewarm)
- `frontend-nextjs/src/app/api/admin/regenerate-stats/route.ts` (admin manual regeneration)

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
- Historical date-keyed completed season files are static frontend assets. Regenerate them with `cd backend && node generate-stats-from-prod.js`, then `cd ../frontend-nextjs && npm run bake-stats-history` after production credentials are configured.
- Historical `season_avg` and `players_stats` completed periods are still generated and cached by the backend period payloads.

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

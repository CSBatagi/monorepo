# Stats Runtime Architecture

## Runtime Flow

1. Root layout's `after()` hook calls `incrementalRefresh()` (cooldown: 5 minutes) which fetches backend `GET /stats/incremental`.
2. Backend compares latest DB match timestamp (polls DB every 60s in background).
3. If updated, backend regenerates incremental datasets once and returns changed payload.
4. Frontend persists payload into `frontend-nextjs/runtime-data/` (or `STATS_DATA_DIR`).
5. Aggregates are refreshed through `/api/stats/aggregates` -> backend `GET /stats/aggregates`.
6. All data API routes (`/api/data/*`) serve from runtime-data with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

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

Update all of the following together:

- `backend/generate-stats-from-prod.js`
- `frontend-nextjs/src/app/layout.tsx`
- `frontend-nextjs/src/app/api/stats/check/route.ts`
- `frontend-nextjs/src/app/api/admin/regenerate-stats/route.ts`
- `frontend-nextjs/src/lib/dataReader.ts`

## Memory Optimizations (1 GB VM)

The platform runs on a 1 GB RAM GCP VM. Key optimizations:

- **PostgreSQL**: tuned to `shared_buffers=32MB`, `work_mem=2MB`, `max_connections=20` (Docker limit: 192M).
- **Backend**: connection pool reduced to 5, V8 heap capped at 128 MB (Docker limit: 256M). Stats queries run in staggered batches of 3-4 instead of 11 parallel. Data cache expires after 5 minutes to free memory.
- **Frontend**: V8 heap capped at 160 MB (Docker limit: 256M). Session auth uses HMAC-SHA256 tokens (`authSession.ts`) instead of firebase-admin for the hot path. firebase-admin only loads lazily for the notification scheduler and admin routes.
- **Caddy**: gzip/zstd compression enabled. Static assets (`/_next/static/*`, `/images/*`) get long-lived cache headers.
- **Incremental refresh cooldown**: 5 minutes (layout.tsx). JSON files written without pretty-printing.

## Diagnostics and Notes

- Main backend stats routes:
  - `GET /stats/incremental` — checks cached DB timestamp (zero DB cost), regenerates if data changed
  - `GET /stats/aggregates` — recomputes season_avg + last10 on demand
  - `POST /stats/force-regenerate` — admin-only, clears all caches and regenerates everything
  - `GET /stats/diagnostics` — returns cached dataset sizes and season config
- Backend polls the DB timestamp every 60s in the background. Page loads never hit the DB directly.
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

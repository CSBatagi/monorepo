# Production Stats Publishing

This is the operational runbook for how database changes become visible on the website.

## Source Of Truth

Match/stat source data lives in PostgreSQL. Generated website datasets are produced by the backend and then persisted by the frontend into `runtime-data/` (`STATS_DATA_DIR`, `/app/runtime-data` in Docker).

The current production mechanism is version based:

1. PostgreSQL triggers mark `stats_refresh_state` dirty when source stats tables change.
2. The backend poller reads `stats_refresh_state`.
3. After the dirty state has stayed quiet for the configured quiet window, the backend generates a complete stats snapshot.
4. The backend completes publishing only if `mutation_version` still matches the version captured at generation start. If CS Demo Manager writes another map during generation, the trigger increments `mutation_version`, and the backend retries after the next quiet window.
5. The backend increments `stats_refresh_state.current_version`, clears `dirty`, and stores the generated snapshot in backend memory.
6. The backend calls the frontend internal prewarm endpoint so the frontend writes the same snapshot to `runtime-data/`.
7. SSR and client refresh paths use `/stats/incremental` and the persisted `stats_meta.json` version to avoid stale reads.

## Timings

These are code defaults unless overridden by environment variables:

- `STATS_POLL_INTERVAL_MS`: `15000` ms.
- `STATS_QUIET_PERIOD_MS`: `30000` ms.
- Internal frontend prewarm retries: `6` attempts, `5000` ms apart, `30000` ms request timeout.
- Public frontend stats check cooldown: `10000` ms.

Do not assume older documentation that says "60s stats poller" is describing this path. The notification scheduler has a 60s loop, but the backend stats state poller defaults to 15s.

## Backend State Table

The backend creates and maintains:

```sql
stats_refresh_state (
  id,
  dirty,
  status,
  source_table,
  current_version,
  mutation_version,
  last_mutation_at,
  last_completed_at,
  updated_at,
  last_error
)
```

Expected healthy states:

- `dirty = false`, `status = 'idle'`: latest published version is ready.
- `dirty = true`, `status = 'dirty'`: source tables changed and backend should publish after the quiet window.
- `status = 'generating'`: generation is in progress. This should be temporary.

If `status = 'generating'` stays old after a backend crash, restart, or OOM, the backend resets it to `dirty` after `STATS_GENERATING_TIMEOUT_MS` so auto-publishing can retry. Treat repeated stale recovery as a production incident because it means generation is failing or the process is restarting mid-publish.

`mutation_version` is the clean DB-change detector. Every trigger hit increments it. The backend captures it before generation and only clears `dirty` if the value is unchanged when generation finishes. This handles CS Demo Manager publishing multiple maps back to back: writes during generation are not lost, and the backend retries after the final quiet window.

## Fixed Production Failure: Microsecond Timestamp Compare

Observed on production on 2026-04-11:

- Backend auto-publish started from `dirty-state-poller`.
- Backend logged `source changed during generation, keeping dirty state for retry`.
- The later admin "Stat Bas" path published successfully because it uses `/stats/force-regenerate`.
- `stats_refresh_state.last_mutation_at` had PostgreSQL microsecond precision, for example `2026-04-10 21:59:36.432990+00`.
- The backend stores this timestamp in a JavaScript `Date`, which preserves only milliseconds, for example `2026-04-10 21:59:36.432000+00`.
- The old `completeStatsPublish()` implementation compared the DB value with the JavaScript value using exact timestamp equality. That exact comparison could fail even when no source table changed during generation.
- When this happened, the backend left the row dirty and could leave `status = 'generating'`, preventing normal auto-publish retries. Manual force-regenerate worked because the force path did not use the exact `last_mutation_at` guard.

Current fix: use `mutation_version` as the completion guard instead of `last_mutation_at`, and recover stale `generating` states after `STATS_GENERATING_TIMEOUT_MS`.

## Source Table Triggers

Current source tables are defined in `backend/index.js` as `STATS_SOURCE_TABLES`:

- `demos`
- `matches`
- `players`
- `teams`
- `rounds`
- `kills`
- `clutches`
- `damages`
- `shots`
- `player_blinds`
- `smokes_start`

Startup creates `touch_stats_refresh_state()` and attaches one statement-level trigger per table named:

```text
<table>_stats_refresh_touch
```

Read-only verification SQL:

```sql
SELECT *
FROM stats_refresh_state
WHERE id = 1;

SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname LIKE '%_stats_refresh_touch'
ORDER BY table_name;
```

If a database publish process recreates tables, disables triggers, loads with a role that bypasses triggers, or writes to tables outside the source table list, the backend will not automatically discover the change. In that case the publish process must explicitly mark stats dirty or run through a path that fires the triggers.

## Website Runtime Snapshot

The frontend writes stats files to `STATS_DATA_DIR` using `statsSnapshot.ts`. The canonical file list is `STAT_FILES` in `frontend-nextjs/src/lib/statsSnapshot.ts`.

Writers:

- Public stats check endpoint `GET /api/stats/check`. Browser callers may pass `keys=a,b` to reduce response size; the endpoint still uses the single global `statsVersion` and writes the complete backend snapshot to `runtime-data/` before filtering the public response.
- Internal prewarm endpoint `POST /api/internal/stats/prewarm`.
- Admin manual endpoint `POST /api/admin/regenerate-stats`.

`stats_meta.json` must only advance after a complete snapshot write. If any existing runtime file is preserved because the new dataset is empty, metadata must not advance.

Large date-keyed historical datasets are split between runtime and static frontend assets:

- `night_avg_periods`
- `sonmac_by_date_periods`

These runtime period payloads follow the same global `statsVersion` as every other stats file, but their `data` contains only the active/current season. Completed season files are committed under:

```text
frontend-nextjs/public/data/stats-history/night_avg/
frontend-nextjs/public/data/stats-history/sonmac_by_date/
```

After refreshing local historical source files, update the committed static shards with:

```text
cd backend
node generate-stats-from-prod.js
cd frontend-nextjs
npm run bake-stats-history
```

`generate-stats-from-prod.js` writes normal runtime files plus bake-only all-time sources under `frontend-nextjs/runtime-data/history-source/`. The bake script splits those sources into committed completed-season shards.

## Admin Manual Publish

The admin "Stat Bas" button calls:

```text
frontend /api/admin/regenerate-stats
backend  /stats/force-regenerate
```

This bypasses the normal dirty-state gate, force-generates stats, writes the returned snapshot to frontend `runtime-data/`, and persists metadata. If "Stat Bas" fixes a missing website update, the likely failure is in one of these areas:

- DB change did not mark `stats_refresh_state.dirty = true`.
- `stats_refresh_state.status` was stuck in `generating`.
- Backend generation failed and left `last_error`.
- Backend published but frontend prewarm/write-through did not complete.
- The page was serving a cached ISR artifact before revalidation.

## First Checks For A Production Incident

Use diagnostics before forcing another publish:

```text
GET /api/stats/diagnostics
```

Check:

- `effectiveStatsState.dirty`
- `effectiveStatsState.status`
- `effectiveStatsState.currentVersion`
- `effectiveStatsState.mutationVersion`
- `effectiveStatsState.lastMutationAt`
- `effectiveStatsState.lastCompletedAt`
- `effectiveStatsState.lastError`
- `lastGeneratedStatsVersion`
- dataset counts such as `sonmac_dates`, `night_avg_dates`, `sonmac_by_date_periods`, and `night_avg_periods`

Then verify DB state/triggers with the SQL in the trigger section.

## Planned Hardening

The next code fix should be conservative:

1. Add stale `generating` recovery with a timeout before retrying.
2. Add a safe explicit "mark stats dirty" maintenance endpoint or SQL function for production DB publish workflows.
3. Add diagnostics that include trigger presence for all `STATS_SOURCE_TABLES`.
4. Add tests for dirty-state publishing, stale `generating` recovery, and frontend prewarm.

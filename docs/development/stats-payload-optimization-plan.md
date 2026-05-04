# Stats Payload Optimization Plan

Date: 2026-05-04

## Goal

Reduce stats update and page-load slowness on the same 1 GB VM without changing the global stats versioning model.

The current global `statsVersion` remains the single freshness marker. Do not reintroduce per-page stats versions.

## Out Of Scope

- Replacing the backend poller with `LISTEN/NOTIFY`.
- Reworking live polling.
- Chart.js bundle splitting.
- Any hardware upgrade.

## Current Issues To Address

1. Some pages that consume stats are not revalidated by the internal prewarm route after a new snapshot is written. **Status: fixed for known missing pages.**
2. Public client refresh can transfer the full generated stats payload, including large all-time datasets, even when the page only needs a subset. **Status: fixed for current browser refresh callers by adding `keys=` filtering.**
3. Historical date-keyed datasets are large:
   - `sonmac_by_date_all.json` is about 4.1 MB in the current local runtime snapshot.
   - `night_avg_all.json` is about 0.8 MB.
4. Documentation says PostgreSQL `max_connections=20`, but `docker-compose.yml` currently uses `max_connections=50`. **Status: investigated and fixed as documentation drift; keep `50`.**
5. Backend season config previously only returned the active `season_start`; the previous season starts found in the local generated period payload are `2025-02-10`, `2025-06-09`, `2025-10-10`, `2026-01-05`, and the current checked-in active season is `2026-04-06`. **Status: backend now parses optional `season_starts`; `frontend-nextjs/public/data/season_start.json` now includes these global boundaries.**

## Current Implementation Status

Completed in the 2026-05-04 pass:

- `frontend-nextjs/src/app/api/internal/stats/prewarm/route.ts`: added `/team-picker` and `/token-wars` to `DATASET_PAGE_MAP`.
- `frontend-nextjs/src/app/api/stats/check/route.ts`: added optional `keys=` filtering for public responses. The endpoint still uses one global `statsVersion`, still calls backend `/stats/incremental`, and still persists the complete runtime snapshot before filtering the response to the browser.
- `frontend-nextjs/src/lib/useStatsRefresh.ts`: added a `keys` option.
- Existing `useStatsRefresh` consumers now pass the datasets they can consume.
- `frontend-nextjs/src/app/team-picker/TeamPickerClient.tsx`: manual stats check now passes `keys=last10,season_avg`.
- `backend/seasonConfig.js`: added optional `season_starts` parsing.
- `frontend-nextjs/public/data/season_start.json`: added known global season starts.
- `PERFORMANCE_REPORT.md`, `docs/development/stats-runtime.md`, and `docs/operations/stats-publishing.md`: aligned with the current contract.
- `backend/test/seasonConfig.test.js`: added coverage for season start parsing.

Next agent should start with **Section 3: Season-Split Historical Datasets** unless the user redirects.

## Constraints

- Preserve global `statsVersion`.
- Preserve current stats page behavior while migrating payload shape.
- Historical data must remain available.
- Previous seasons can be treated as static once their end date is known.
- Active/current season remains regenerated on every stats publish.
- Runtime snapshot metadata must only advance after a complete compatible snapshot write.

## Planned Work

### 1. Low-Risk Prewarm Fix

Update `frontend-nextjs/src/app/api/internal/stats/prewarm/route.ts` so every stats-consuming route is included in `DATASET_PAGE_MAP`.

Known missing paths to add:

- `/team-picker` for `season_avg` and `last10`.
- `/token-wars` for `night_avg_all` and `sonmac_by_date_all`.

This preserves global versioning and only fixes cache invalidation coverage.

Status: implemented for `/team-picker` and `/token-wars`.

### 2. Public Refresh Payload Filtering

Keep `/api/stats/check` using the same global version, but allow callers to request dataset keys. The frontend hook should pass the keys each client can consume.

Expected shape:

```text
GET /api/stats/check?lastKnownVersion=<globalVersion>&keys=last10,season_avg
```

The endpoint still contacts backend `/stats/incremental` with the global version. If unchanged, it returns unchanged metadata. If updated, it persists the full snapshot to `runtime-data/` as today, then returns only the requested datasets to the browser.

This avoids per-page freshness logic while reducing browser JSON transfer and parse cost.

Status: implemented for existing `useStatsRefresh` consumers and the Team Picker manual stats check.

### 3. Season-Split Historical Datasets

Investigate and then implement a compatible split for large historical datasets:

- Keep active/current season data regenerated in normal publish flow.
- Store completed season datasets by season period, keyed by configured season starts and derived end dates.
- Keep historical season outputs static unless the admin force-regenerate path explicitly rebuilds them.
- Continue exposing compatibility fields during migration so existing pages do not break.

Candidate snapshot fields:

```text
night_avg_periods
sonmac_by_date_periods
```

The existing `season_avg_periods` and `players_stats_periods` structure is the preferred local pattern.

Candidate page behavior:

- Pages that only need the current season should consume current-season datasets.
- Pages that need historical filters should fetch or receive period payloads and select one season at a time.
- Avoid sending merged all-time date-keyed payloads to the browser by default.

Before implementing this part, confirm every consumer of `night_avg_all` and `sonmac_by_date_all`, including feature pages such as Batak All-Stars and Token Wars.

Known consumers from the 2026-05-04 read-only inspection:

- `/gece-ortalama`: `night_avg_all`
- `/performans-odulleri`: `night_avg_all`
- `/gecenin-mvpsi`: `night_avg_all`
- `/sonmac`: `sonmac_by_date_all`
- `/mac-sonuclari`: `sonmac_by_date_all`
- `/batak-allstars`: `night_avg_all` + `sonmac_by_date_all`; pinned feature range can differ from global season
- `/token-wars`: `night_avg_all` + `sonmac_by_date_all`; currently uses all-time data to avoid stale season-filtered ISR across season changes
- `/oyuncular`: already uses `players_stats_periods`
- `/season-avg`: already uses `season_avg_periods`

### 4. PostgreSQL Connection Setting Alignment

Inspect git history to determine why `docker-compose.yml` uses `max_connections=50`.

Then either:

- keep `50` and update `PERFORMANCE_REPORT.md` plus `docs/development/stats-runtime.md`, or
- lower code to `20` if history shows no current reason and backend pool usage supports it.

Do not change this setting blindly; align code and docs after the history check.

Status: git history showed `max_connections=50` was intentional. Keep code at `50` and align docs.

## Verification

Last verified on 2026-05-04 after the completed changes:

```text
node --check backend/seasonConfig.js
node --check backend/statsGenerator.js
node --check backend/index.js
cd backend && npm test -- --runInBand
cd frontend-nextjs && npm run build
git diff --check
```

Results: all passed. Frontend build still warned about multiple lockfiles and stale Browserslist data; those were pre-existing/unrelated and not fixed in this pass.

For future changes, run at minimum:


```text
cd backend && npm test -- --runInBand
cd frontend-nextjs && npm run build
```

If stats-generation code changes, also run:

```text
node --check backend/statsGenerator.js
node --check backend/index.js
```

## Handoff Notes

- Global stats versioning is a user requirement. Do not replace it with per-page versioning.
- Prewarm cache coverage and public refresh payload filtering are already implemented.
- The next meaningful performance win is the season-split historical dataset work.
- The season-split work is higher risk and should be introduced with compatibility fields first, then migrate consumers gradually.
- `docs/development/stats-runtime.md`, `docs/operations/stats-publishing.md`, and `PERFORMANCE_REPORT.md` must be kept in sync with any runtime contract change.

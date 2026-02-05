# Stats Runtime Architecture

## Runtime Flow

1. Frontend calls `/api/stats/check` which proxies backend `GET /stats/incremental`.
2. Backend compares latest DB match timestamp.
3. If updated, backend regenerates incremental datasets once and returns changed payload.
4. Frontend persists payload into `frontend-nextjs/runtime-data/` (or `STATS_DATA_DIR`).
5. Aggregates are refreshed through `/api/stats/aggregates` -> backend `GET /stats/aggregates`.

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

## Diagnostics and Notes

- Main backend stats routes:
  - `GET /stats/incremental`
  - `GET /stats/aggregates`
  - `POST /stats/force-regenerate`
  - `GET /stats/diagnostics`
- Legacy route `/stats/check-and-update` is deprecated and should not be used in new code.
- Some older backend tests still target `/stats/check-and-update` and may fail until updated.

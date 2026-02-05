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
- Main backend stats routes are `/stats/incremental`, `/stats/aggregates`, `/stats/force-regenerate`, `/stats/diagnostics`.
- If you add/rename a stats file, update all sync points listed in `docs/development/stats-runtime.md`.

## Scope Rule

Keep this file short and stable. Put operational detail in `docs/` files to avoid drift.

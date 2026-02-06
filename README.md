# CS Batagi Stats Platform

Monorepo for CS2 stats generation, APIs, and the Next.js frontend.

## Start Here

- Agent entrypoint: [`AGENTS.md`](AGENTS.md)
- Documentation index: [`docs/README.md`](docs/README.md)
- Development guide: [`DEVELOPMENT.md`](DEVELOPMENT.md)
- Security rules: [`SECURITY.md`](SECURITY.md)

## Quick Start (Stats Viewer)

Use this if you only want local stats pages and do not need a local DB.

```powershell
cd backend
$env:PROD_DB_HOST = "db2.csbatagi.com"
$env:PROD_DB_USER = "readonly"
$env:PROD_DB_PASSWORD = "your_readonly_password"
$env:PROD_DB_DATABASE = "csdm"
node generate-stats-from-prod.js

cd ../frontend-nextjs
npm install
npm run dev
```

Open `http://localhost:3000`.

## Repo Layout

- `backend/`: Express API, DB queries, stats generation.
- `frontend-nextjs/`: Next.js app and runtime JSON reader.
- `docs/`: Canonical project documentation.

## Notes

- Runtime stats architecture uses `/stats/incremental` and `/stats/aggregates`.
- Season boundaries live in `frontend-nextjs/public/data/season_start.json`.

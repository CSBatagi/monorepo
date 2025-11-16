# CS Batağı Stats Platform

A full-stack CS:GO/CS2 statistics tracking and visualization platform.

## 🚀 Quick Start (Stats Viewing Only)

**Just want to view stats locally?** No database needed:

```powershell
# 1. Clone and install
git clone https://github.com/CSBatagi/monorepo.git
cd monorepo/frontend-nextjs
npm install

# 2. Generate stats from production (requires readonly credentials)
cd ../backend
$env:PROD_DB_HOST = "db2.csbatagi.com"
$env:PROD_DB_USER = "readonly"
$env:PROD_DB_PASSWORD = "your_readonly_password"
node generate-stats-from-prod.js

# 3. Run frontend
cd ../frontend-nextjs
npm run dev
```

Visit http://localhost:3000 to view stats!

**Full setup guide:** [DEVELOPMENT.md](DEVELOPMENT.md)

---

## Structure

- `frontend/` (removed): Legacy static site replaced by Next.js app under `frontend-nextjs/`.
  - All runtime/stat logic now lives in backend + Next.js server components.
- `backend/`: Contains the backend Node.js application
  - Express.js server
  - Database connections (PostgreSQL, MySQL)
  - API endpoints

## Development

### Frontend

To work on the frontend:

```bash
cd frontend
npm install
# Start your development server
```

### Backend

To work on the backend:

```bash
cd backend
npm install
node index.js
```

## Deployment

### Backend Deployment

The backend is deployed to a Google Cloud Platform (GCP) virtual machine using GitHub Actions. The deployment process:

1. Builds a Docker image of the backend
2. Pushes the image to GitHub Container Registry (ghcr.io)
3. Deploys the image to a GCP VM using docker-compose

For setting up GCP credentials, refer to the [instructions.md](instructions.md) file.

### Required Secrets

The following GitHub repository secrets are required for deployment:

- `GOOGLE_CREDENTIALS`: JSON credentials file for GCP service account
- `GCP_ZONE`: The zone where your GCP VM is located
- `GCP_VM_NAME`: The name of your GCP VM
- `AUTH_TOKEN`: Authentication token for the backend
- `DB_PASSWORD`: Database password
- `DB_USER`: Database user
- `CLOUDFLARE_API_TOKEN`: API token for Cloudflare DNS updates
- `MYSQL_PASSWORD`: MySQL database password
- `MYSQL_ROOT_PASSWORD`: MySQL root password
- `MYSQL_USER`: MySQL user
- `POSTGRES_PASSWORD`: PostgreSQL password
- `POSTGRES_READONLY_PASSWORD`: PostgreSQL read-only user password
- `RCON_PASSWORD`: RCON password for game server communication

## GitHub Workflows

- `build_backend.yml`: Builds and pushes the backend Docker image to GitHub Container Registry
- `deploy_backend.yml`: Deploys the backend to a GCP VM
- `deploy_frontend.yml`: Deploys the classic static frontend (GitHub Pages)
- `stats.yml`: (Deprecated) Formerly generated static JSON stats. Now a NO-OP; dynamic generation occurs at runtime.

Path filtering keeps workflow triggers scoped:
- Backend workflows: changes under `backend/` or their workflow files.
- Frontend workflows: changes under `frontend/` or their workflow files.

### Dynamic Stats Generation (Current Architecture)

Two categories of datasets:
1. Aggregates (always recomputed each page view): `season_avg.json`, `last10.json`.
2. Incremental (regenerated only when new matches detected): `night_avg.json`, `sonmac_by_date.json`, `duello_son_mac.json`, `duello_sezon.json`, `performance_data.json`.

Flow per request:
1. A page request hits Next.js `RootLayout`; it calls backend `/stats/incremental?lastKnownTs=<persisted>`.
2. Backend compares DB max match date; if newer it regenerates full dataset set once and returns updated data; otherwise returns `updated:false` with latest timestamp.
3. Layout writes updated incremental JSONs to the runtime volume when `updated:true`.
4. Aggregated pages (`/season-avg`, `/last10`) additionally call `/api/stats/aggregates` (frontend route) which proxies backend `/stats/aggregates` and always persists fresh aggregate JSONs.
5. A small file `runtime-data/last_timestamp.txt` stores the last server timestamp across restarts (warm caches after deploys).

Removed legacy endpoint `/stats/check-and-update` and deprecated GitHub Action `stats.yml` (runtime generation fully handles freshness now).

### Concurrency Control
Incremental regeneration guarded by a single in-memory promise on backend to avoid duplicate expensive queries.

### Re-enabling Static Generation (Optional)
Restore removed workflow `stats.yml` from git history and reintroduce a pre-generation script if a static deployment model is desired again.

### Season Start Resolution (Production Ready)
The backend resolves the season start date using this priority order (first match wins):
1. `SEASON_START_FILE` env var pointing to a JSON file path (inside container) containing `{ "season_start": "YYYY-MM-DD" }`.
2. A file named `season_start.json` present in backend working directory (e.g. mounted via volume).
3. Production config path `config/season_start.json`.
4. Monorepo dev path `frontend-nextjs/public/data/season_start.json`.
5. `SEZON_BASLANGIC` env var (legacy fallback).
6. Default `2025-06-09`.

**Production setup (recommended):**
```yaml
  backend:
    environment:
      - SEASON_START_FILE=/app/config/season_start.json
    volumes:
      - ./config/season_start.json:/app/config/season_start.json:ro
```

**Managing season start date:**
- Edit `config/season_start.json` with the new season start date in `YYYY-MM-DD` format
- The backend will automatically reload the date on next stats generation
- No container restart needed - changes take effect on next stats request

### Environment Variables Relevant to Stats
| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| BACKEND_INTERNAL_URL | Internal URL front-end API routes use to reach backend | yes (frontend) | http://backend:3000 |
| STATS_DATA_DIR | Directory (in Next.js container) where refreshed JSON files persist | yes (frontend) | /app/runtime-data |
| SEASON_START_FILE | Absolute path to season_start.json (preferred over baking) | no | (unset) |
| SEZON_BASLANGIC | Legacy manual season start fallback | no | 2025-06-09 |
| DB_HOST / DB_USER / DB_PASSWORD / DB_DATABASE | Postgres access for stats queries | yes (backend) | - |

If no explicit season start file or env var is provided the default date applies, which may skew stats at a new season rollover.

### Manual Forcing of Regeneration
Delete `runtime-data/last_timestamp.txt` (or set an older timestamp) then hit any page; backend will regenerate on next incremental call. Aggregates always refresh automatically when their pages are requested.

### Adding a New Stats Page
1. Add backend query & integrate into `generateAll()` or `generateAggregates()`.
2. Whitelist filename in frontend incremental (if non-aggregate) or aggregates route (if always recompute).
3. Create page server component that reads the JSON; no client refresh hook needed.

### Future Ideas
- Metadata file (e.g. `stats_meta.json`) storing generation duration & checksum for lightweight change detection.
- Scheduled warm-up (optional) if you expect large initial latency after long idle periods.
- Add service healthchecks (see below) and integrate with container orchestrator restarts.

### Optional Healthchecks
Example snippet you can append to `docker-compose.yml`:
```yaml
  backend:
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/stats/diagnostics || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
  frontend-nextjs:
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## GitHub Pages Deployment

The frontend is automatically deployed to GitHub Pages when changes are pushed to the main branch. The deployment workflow is defined in `.github/workflows/deploy_frontend.yml`. The workflow deploys the content of the `frontend` directory to GitHub Pages, which is then served at the repository's GitHub Pages URL.

## Docker Compose

The project uses Docker Compose for deploying multiple services:
- Backend Node.js application
- PostgreSQL database
- MySQL database (for Get5)
- Caddy reverse proxy
- Cloudflare DDNS updater

The Docker Compose file is configured to use the `main` tag for the backend image from GitHub Container Registry.

## Adding New Components

As the project grows, new components can be added as separate directories at the root level.

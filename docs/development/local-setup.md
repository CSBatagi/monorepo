# Local Setup

## Option A: Stats Viewer Only (No Local DB)

Use when you only need the frontend with generated JSON files.

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

## Option B: Full Local Development

Use when you need backend APIs, regeneration behavior, and local DB workflows.

1. Start local DB:
```powershell
docker compose -f docker-compose.local.yml up -d
```
2. Prepare env files:
- Root template: `.env.local.example` -> `.env.local`
- Backend template: `backend/.env.example` -> `backend/.env`
- Frontend template: `frontend-nextjs/.env.example` -> `frontend-nextjs/.env.local`
3. Resolve port collision:
- Backend default: `3000`
- Next.js dev default: `3000`
- If both run locally, set backend to `3001` and set `BACKEND_INTERNAL_URL=http://localhost:3001` in `frontend-nextjs/.env.local`.

## Validation

```powershell
node --check backend/statsGenerator.js
node --check backend/index.js
cd frontend-nextjs
npm run build -- --no-lint
```

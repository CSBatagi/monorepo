# Local Development Setup Guide

This guide will help you set up a local development environment for the CS Batağı monorepo.

## Two Setup Options

### Option A: Stats Viewing Only (Simplest)
**Use this if you only want to view stats locally without uploading matches**
- ✅ No local database needed
- ✅ Frontend only
- ✅ Quick setup
- ❌ Can't upload new matches
- ❌ Can't test backend API

### Option B: Full Development Environment
**Use this if you need to test match uploads, backend API, or server management**
- ✅ Full backend functionality
- ✅ Local database for testing
- ✅ Test match uploads
- ⚠️ More complex setup

---

## Option A: Stats Viewing Only (Recommended for most users)

---

## Option A: Stats Viewing Only (Recommended for most users)

### Prerequisites
- **Node.js** (v18 or later) - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)

### Quick Setup

1. **Clone and install dependencies**
   ```powershell
   git clone https://github.com/CSBatagi/monorepo.git
   cd monorepo/frontend-nextjs
   npm install
   ```

2. **Generate stats from production**
   ```powershell
   # Set production database credentials
   $env:PROD_DB_HOST = "db2.csbatagi.com"
   $env:PROD_DB_USER = "readonly"
   $env:PROD_DB_PASSWORD = "your_readonly_password"
   $env:PROD_DB_DATABASE = "csdm"
   
   # Generate stats JSONs
   cd ../backend
   node generate-stats-from-prod.js
   ```

3. **Run frontend**
   ```powershell
   cd ../frontend-nextjs
   npm run dev
   ```

4. **Visit** http://localhost:3000

That's it! Your frontend now has production stats data without needing a local database.

**To refresh stats:** Re-run `node generate-stats-from-prod.js` anytime.

---

## Option B: Full Development Environment

Use this only if you need to test backend functionality (match uploads, server management, etc.).

### Additional Prerequisites
- **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop)

### Setup Steps

### 1. Set up credentials

First, create your local environment file with credentials:

```powershell
# Copy the example file
cp .env.local.example .env.local

# Edit .env.local and add your actual credentials
# NEVER commit this file to git!
```

Example `.env.local` contents:
```env
POSTGRES_USER=myuser
POSTGRES_PASSWORD=mysecurepassword
PROD_DB_HOST=your.production.host
PROD_DB_USER=readonly
PROD_DB_PASSWORD=your_readonly_password
```

### 2. Load environment variables

```powershell
# PowerShell: Load variables into current session
Get-Content .env.local | ForEach-Object { 
    if($_ -match '^([^=]+)=(.*)$') { 
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
    }
}
```

### 3. Run the setup script

Run the setup script from the repository root:

```powershell
.\setup-local-env.ps1
```

This script will:
- Check prerequisites
- Start PostgreSQL in Docker
- Create environment files from templates
- Install all dependencies
- Create necessary directories

Then follow the manual configuration steps below.

## Manual Setup

### 1. Clone the Repository

```powershell
git clone https://github.com/CSBatagi/monorepo.git
cd monorepo
```

### 2. Start PostgreSQL Database

Start the local PostgreSQL database using Docker Compose:

```powershell
docker compose -f docker-compose.local.yml up -d
```

The PostgreSQL instance will use credentials from your environment variables (`.env.local`).

### 3. Configure Backend

Create the backend environment file:

```powershell
cd backend
cp .env.example .env
```

Edit `backend/.env` and update with your credentials:

```env
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
AUTH_TOKEN=your_auth_token
```

**Security Note:** Never commit `.env` files with real credentials to git!

**Note:** If you have a `.backend_secrets` file in the root, the setup script will automatically convert it to `.env` format.

Optional variables (for full functionality):
- `RCON_PASSWORD` - If testing CS2 server integration
- `VM_NAME`, `GCP_ZONE` - If testing GCP VM management
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to GCP credentials JSON

Install backend dependencies:

```powershell
npm install
```

### 4. Configure Frontend

Create the frontend environment file:

```powershell
cd ../frontend-nextjs
cp .env.example .env.local
```

Edit `frontend-nextjs/.env.local` and add your Firebase configuration:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

BACKEND_INTERNAL_URL=http://localhost:3000
```

To get Firebase credentials:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (or create a new one)
3. Go to Project Settings → General
4. Scroll to "Your apps" and find your web app config

Install frontend dependencies:

```powershell
npm install
```

### 5. Set Up Database Schema

You need to import the database schema into your local PostgreSQL. If you have access to the production database, you can export the schema:

```powershell
# On a machine with access to production DB
pg_dump -h production-host -U user -d csdm --schema-only > schema.sql

# Then import locally
psql -h localhost -U postgres -d csdm -f schema.sql
```

Alternatively, contact a team member for a database dump.

## Running the Application

### Start Backend

Open a terminal in the `backend` directory:

```powershell
cd backend
npm start
```

The backend will start on http://localhost:3000

You should see:
```
Middleware is running on port 3000
```

### Start Frontend

Open a **new terminal** in the `frontend-nextjs` directory:

```powershell
cd frontend-nextjs
npm run dev
```

The frontend will start on http://localhost:3000 (Next.js)

Visit http://localhost:3000 in your browser to see the application.

**Note:** Both services run on port 3000. The frontend's Next.js development server will be accessible in your browser, and it will proxy backend requests to the backend service.

## Development Workflow

### Backend Development

The backend uses Node.js with Express and restarts automatically with changes:

```powershell
cd backend
npm start  # Or use nodemon for auto-restart: npx nodemon index.js
```

**Testing:**
```powershell
npm test                    # Run unit tests
npm run test:integration    # Run integration tests
```

### Frontend Development

The frontend uses Next.js 15 with Turbopack for fast refresh:

```powershell
cd frontend-nextjs
npm run dev           # Uses Turbopack (faster)
npm run dev-no-turbopack  # Without Turbopack
```

**Building:**
```powershell
npm run build   # Create production build
npm start       # Run production build
```

### Working with Stats

The application generates stats dynamically. On first run, you may see empty data until matches are added to the database.

**Stats Generation Flow:**
1. Frontend `layout.tsx` calls `/stats/incremental` on page load
2. Backend checks if DB has new data (via timestamp)
3. If new data exists, backend regenerates stats and returns JSON
4. Frontend writes JSON to `runtime-data/` directory

**Force Stats Regeneration:**
```powershell
# Delete timestamp file
Remove-Item frontend-nextjs\runtime-data\last_timestamp.txt

# Refresh any page in browser
```

**Check Stats Generation Status:**
Visit http://localhost:3000/backend/stats/diagnostics

### Database Management

**Connect to PostgreSQL:**
```powershell
```bash
psql -h localhost -U $POSTGRES_USER -d csdm
```
```

**Common Commands:**
```sql
-- List all tables
\dt

-- View matches
SELECT * FROM matches ORDER BY date DESC LIMIT 10;

-- View players
SELECT * FROM players LIMIT 10;

-- Exit
\q
```

**Stop Database:**
```powershell
docker compose -f docker-compose.local.yml down
```

**Reset Database (deletes all data):**
```powershell
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up -d
```

## Troubleshooting

### Backend won't start

**Error:** `Error: connect ECONNREFUSED`
- **Solution:** Ensure PostgreSQL is running: `docker ps` should show `csbatagi-postgres-local`
- **Solution:** Check `DB_HOST=localhost` in `backend/.env`

**Error:** `Authentication failed`
- **Solution:** Verify `DB_PASSWORD` matches your Docker container password in `backend/.env`
- **Solution:** Verify `DB_USER` matches your Docker container user in `backend/.env`

### Frontend shows empty data

**Problem:** No stats displayed
- **Solution:** Ensure backend is running on http://localhost:3000
- **Solution:** Check `BACKEND_INTERNAL_URL=http://localhost:3000` in `frontend-nextjs/.env.local`
- **Solution:** Add sample data to the database or import a database dump
- **Solution:** Check browser console for API errors

### Stats not updating

**Problem:** Data seems stale
- **Solution:** Delete `frontend-nextjs/runtime-data/last_timestamp.txt`
- **Solution:** Check backend logs for SQL errors
- **Solution:** Visit http://localhost:3000/backend/stats/diagnostics

### Firebase authentication issues

**Problem:** Can't sign in
- **Solution:** Verify all `NEXT_PUBLIC_FIREBASE_*` variables are set correctly
- **Solution:** Check Firebase Console → Authentication → Sign-in method is enabled
- **Solution:** Add `localhost:3000` to Firebase authorized domains

### Port already in use

**Error:** `EADDRINUSE: address already in use :::3000`
- **Solution:** Find and kill the process using port 3000:
  ```powershell
  # Find process
  netstat -ano | findstr :3000
  
  # Kill process (replace PID with actual process ID)
  taskkill /PID <PID> /F
  ```

## Project Structure

```
monorepo/
├── backend/                    # Express.js API server
│   ├── index.js               # Main server file
│   ├── statsGenerator.js      # Stats computation logic
│   ├── gcp.js                 # GCP VM management
│   ├── rcon.js                # CS2 RCON client
│   └── test/                  # Unit tests
├── frontend-nextjs/           # Next.js frontend
│   ├── src/
│   │   ├── app/              # Next.js App Router pages
│   │   ├── components/       # React components
│   │   ├── contexts/         # React contexts (auth)
│   │   ├── lib/              # Utility functions
│   │   └── types/            # TypeScript types
│   ├── public/               # Static assets
│   └── runtime-data/         # Generated stats (gitignored)
├── docker-compose.local.yml  # Local PostgreSQL setup
└── setup-local-env.ps1       # Automated setup script
```

## Next Steps

1. **Import Sample Data:** Contact a team member for a database dump with sample matches
2. **Configure Firebase:** Set up authentication in Firebase Console
3. **Explore the Code:** Check `.github/copilot-instructions.md` for architecture details
4. **Run Tests:** `cd backend && npm test`
5. **Join the Team:** Ask questions in the team chat!

## Useful Commands

```powershell
# Start everything
docker compose -f docker-compose.local.yml up -d
cd backend; npm start
cd frontend-nextjs; npm run dev

# Stop everything
docker compose -f docker-compose.local.yml down
# Press Ctrl+C in backend terminal
# Press Ctrl+C in frontend terminal

# View logs
docker compose -f docker-compose.local.yml logs -f
docker logs csbatagi-postgres-local

# Clean install
Remove-Item -Recurse backend\node_modules, frontend-nextjs\node_modules
cd backend; npm install
cd frontend-nextjs; npm install
```

## Getting Help

- **Documentation:** `.github/copilot-instructions.md`
- **README:** Main project README.md
- **Team Chat:** [Your team communication channel]
- **Issues:** [GitHub Issues](https://github.com/CSBatagi/monorepo/issues)

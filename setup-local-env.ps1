# CS Batagi Local Development Environment Setup Script
# This script helps you set up your local development environment

param(
    [switch]$SkipDocker,
    [switch]$SkipNpm
)

Write-Host "=== CS Batagi Local Development Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed and running
if (-not $SkipDocker) {
    Write-Host "Checking Docker..." -ForegroundColor Yellow
    try {
        $dockerVersion = docker --version
        Write-Host "OK Docker found: $dockerVersion" -ForegroundColor Green
        
        # Check if Docker daemon is running
        docker ps > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "OK Docker daemon is running" -ForegroundColor Green
        } else {
            Write-Host "X Docker daemon is not running. Please start Docker Desktop." -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "X Docker not found. Please install Docker Desktop from https://www.docker.com/products/docker-desktop" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Check if Node.js is installed
if (-not $SkipNpm) {
    Write-Host "Checking Node.js..." -ForegroundColor Yellow
    try {
        $nodeVersion = node --version
        Write-Host "OK Node.js found: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "X Node.js not found. Please install Node.js from https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Start PostgreSQL container
if (-not $SkipDocker) {
    Write-Host "Setting up local PostgreSQL database..." -ForegroundColor Yellow
    docker compose -f docker-compose.local.yml up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK PostgreSQL container started" -ForegroundColor Green
        Write-Host "  Database available at localhost:5432" -ForegroundColor Gray
        Write-Host "  Database: csdm" -ForegroundColor Gray
        Write-Host "  Credentials configured from docker-compose.local.yml" -ForegroundColor Gray
    } else {
        Write-Host "X Failed to start PostgreSQL container" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Create backend .env file
Write-Host "Setting up backend environment..." -ForegroundColor Yellow
if (-not (Test-Path "backend\.env")) {
    if (Test-Path ".backend_secrets") {
        Write-Host "Found .backend_secrets file, converting to .env format..." -ForegroundColor Yellow
        
        $backendEnv = "# Backend Environment Variables (auto-generated from .backend_secrets)`nDB_HOST=localhost`nDB_PORT=5432`nDB_DATABASE=csdm`n"
        
        Get-Content ".backend_secrets" | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#')) {
                $converted = $line -replace ':\s*', '='
                $backendEnv += "$converted`n"
            }
        }
        
        $backendEnv += "`n# GCP Configuration`nVM_NAME=cs2-server`nGCP_ZONE=europe-west3-c`nGOOGLE_APPLICATION_CREDENTIALS=../credentials.json`n`n# Server Configuration`nPORT=3000`nNODE_ENV=development`n"
        
        $backendEnv | Out-File -FilePath "backend\.env" -Encoding utf8
        Write-Host "OK Created backend/.env from .backend_secrets" -ForegroundColor Green
    } else {
        Copy-Item "backend\.env.example" "backend\.env"
        Write-Host "OK Created backend/.env from template" -ForegroundColor Green
        Write-Host "  Please edit backend/.env and add your credentials" -ForegroundColor Yellow
    }
} else {
    Write-Host "OK backend/.env already exists" -ForegroundColor Green
}

# Install backend dependencies
if (-not $SkipNpm) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    Push-Location backend
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK Backend dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "X Failed to install backend dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host ""
}

# Create frontend .env.local file
Write-Host "Setting up frontend environment..." -ForegroundColor Yellow
if (-not (Test-Path "frontend-nextjs\.env.local")) {
    Copy-Item "frontend-nextjs\.env.example" "frontend-nextjs\.env.local"
    Write-Host "OK Created frontend-nextjs/.env.local from template" -ForegroundColor Green
    Write-Host "  Please edit frontend-nextjs/.env.local and add your Firebase credentials" -ForegroundColor Yellow
} else {
    Write-Host "OK frontend-nextjs/.env.local already exists" -ForegroundColor Green
}

# Install frontend dependencies
if (-not $SkipNpm) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location frontend-nextjs
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK Frontend dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "X Failed to install frontend dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host ""
}

# Create runtime-data directory
Write-Host "Creating runtime directories..." -ForegroundColor Yellow
if (-not (Test-Path "frontend-nextjs\runtime-data")) {
    New-Item -ItemType Directory -Path "frontend-nextjs\runtime-data" -Force > $null
    Write-Host "OK Created frontend-nextjs/runtime-data" -ForegroundColor Green
} else {
    Write-Host "OK frontend-nextjs/runtime-data already exists" -ForegroundColor Green
}
Write-Host ""

Write-Host "=== Setup Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit backend/.env with your database credentials and API tokens" -ForegroundColor White
Write-Host "2. Edit frontend-nextjs/.env.local with your Firebase configuration" -ForegroundColor White
Write-Host "3. Run the backend:" -ForegroundColor White
Write-Host "   cd backend; npm start" -ForegroundColor Gray
Write-Host "4. In a new terminal, run the frontend:" -ForegroundColor White
Write-Host "   cd frontend-nextjs; npm run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "See DEVELOPMENT.md for detailed instructions" -ForegroundColor Yellow

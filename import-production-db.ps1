# Script to import production database to local PostgreSQL
# This script pulls data from production and imports it into your local database

param(
    [string]$ProductionHost = $env:PROD_DB_HOST,
    [string]$ProductionUser = $env:PROD_DB_USER,
    [string]$ProductionPassword = $env:PROD_DB_PASSWORD,
    [string]$ProductionDB = $env:PROD_DB_DATABASE,
    [string]$LocalHost = "localhost",
    [string]$LocalUser = $env:POSTGRES_USER,
    [string]$LocalPassword = $env:POSTGRES_PASSWORD,
    [string]$LocalDB = $env:POSTGRES_DB
)

# Validate required parameters
if (-not $ProductionHost -or -not $ProductionUser -or -not $ProductionPassword) {
    Write-Host "Error: Missing production database credentials" -ForegroundColor Red
    Write-Host "Please set environment variables: PROD_DB_HOST, PROD_DB_USER, PROD_DB_PASSWORD" -ForegroundColor Yellow
    Write-Host "Or pass them as parameters: -ProductionHost <host> -ProductionUser <user> -ProductionPassword <pass>" -ForegroundColor Yellow
    exit 1
}

if (-not $LocalUser -or -not $LocalPassword) {
    Write-Host "Error: Missing local database credentials" -ForegroundColor Red
    Write-Host "Please set environment variables: POSTGRES_USER, POSTGRES_PASSWORD" -ForegroundColor Yellow
    exit 1
}

Write-Host "=== CS Batagi Database Import ===" -ForegroundColor Cyan
Write-Host ""

# Check if pg_dump and psql are available
try {
    $null = Get-Command pg_dump -ErrorAction Stop
    $null = Get-Command psql -ErrorAction Stop
    Write-Host "OK PostgreSQL tools found" -ForegroundColor Green
} catch {
    Write-Host "X PostgreSQL client tools not found. Please install PostgreSQL client tools." -ForegroundColor Red
    Write-Host "  Download from: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "  Or install via: winget install PostgreSQL.PostgreSQL" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Set password environment variables
$env:PGPASSWORD = $ProductionPassword

Write-Host "Step 1: Dumping production database schema and data..." -ForegroundColor Yellow
Write-Host "  From: $ProductionUser@$ProductionHost/$ProductionDB" -ForegroundColor Gray

$dumpFile = "production_dump_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"

try {
    pg_dump -h $ProductionHost -U $ProductionUser -d $ProductionDB -F p -f $dumpFile
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed with exit code $LASTEXITCODE"
    }
    Write-Host "OK Database dump created: $dumpFile" -ForegroundColor Green
} catch {
    Write-Host "X Failed to dump production database" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Switch to local password
$env:PGPASSWORD = $LocalPassword

Write-Host "Step 2: Importing to local database..." -ForegroundColor Yellow
Write-Host "  To: $LocalUser@$LocalHost/$LocalDB" -ForegroundColor Gray

try {
    psql -h $LocalHost -U $LocalUser -d $LocalDB -f $dumpFile
    if ($LASTEXITCODE -ne 0) {
        throw "psql import failed with exit code $LASTEXITCODE"
    }
    Write-Host "OK Database imported successfully" -ForegroundColor Green
} catch {
    Write-Host "X Failed to import to local database" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  The dump file has been saved: $dumpFile" -ForegroundColor Yellow
    Write-Host "  You can try importing manually with:" -ForegroundColor Yellow
    Write-Host "  psql -h localhost -U \$env:POSTGRES_USER -d csdm -f $dumpFile" -ForegroundColor Gray
    exit 1
}
Write-Host ""

Write-Host "Step 3: Verifying import..." -ForegroundColor Yellow
try {
    $tableCount = psql -h $LocalHost -U $LocalUser -d $LocalDB -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
    $matchCount = psql -h $LocalHost -U $LocalUser -d $LocalDB -t -c "SELECT COUNT(*) FROM matches;"
    $playerCount = psql -h $LocalHost -U $LocalUser -d $LocalDB -t -c "SELECT COUNT(*) FROM players;"
    
    Write-Host "OK Tables found: $($tableCount.Trim())" -ForegroundColor Green
    Write-Host "OK Matches imported: $($matchCount.Trim())" -ForegroundColor Green
    Write-Host "OK Players imported: $($playerCount.Trim())" -ForegroundColor Green
} catch {
    Write-Host "! Could not verify import (data may still be imported)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "=== Import Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart your backend server to refresh stats" -ForegroundColor White
Write-Host "2. Delete frontend-nextjs/runtime-data/last_timestamp.txt to force stats regeneration" -ForegroundColor White
Write-Host "3. Visit http://localhost:3001 to see your data" -ForegroundColor White
Write-Host ""
Write-Host "The dump file has been saved as: $dumpFile" -ForegroundColor Yellow
Write-Host "You can delete it or keep it as a backup" -ForegroundColor Gray

# Load Environment Variables from .env.local
# Usage: .\load-env.ps1

$envFile = ".env.local"

if (-not (Test-Path $envFile)) {
    Write-Host "Error: $envFile not found" -ForegroundColor Red
    Write-Host "Create it by copying .env.local.example:" -ForegroundColor Yellow
    Write-Host "  cp .env.local.example .env.local" -ForegroundColor Gray
    Write-Host "Then edit it with your actual credentials" -ForegroundColor Yellow
    exit 1
}

Write-Host "Loading environment variables from $envFile..." -ForegroundColor Yellow

$loadedCount = 0
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    # Skip empty lines and comments
    if ($line -and -not $line.StartsWith('#')) {
        if ($line -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $value)
            Write-Host "  ✓ $key" -ForegroundColor Green
            $loadedCount++
        }
    }
}

Write-Host "`n✓ Loaded $loadedCount environment variables" -ForegroundColor Green
Write-Host "You can now run scripts that require these credentials" -ForegroundColor Gray

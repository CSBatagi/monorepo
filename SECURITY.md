# Security Guidelines for CS Batağı Monorepo

## ⚠️ CRITICAL: Never Commit Credentials to Git

This repository is **PUBLIC**. Never commit files containing:
- Database passwords
- API keys
- Authentication tokens
- RCON passwords
- GCP credentials
- Any sensitive configuration

## Protected Files (Already in .gitignore)

These files are automatically ignored and safe to use locally:

```
.env                           # Root environment variables
.env.local                     # Local environment variables
backend/.env                   # Backend configuration
frontend-nextjs/.env.local     # Frontend configuration
.pg_secrets.local              # Local PostgreSQL secrets (matches production format)
credentials.json               # GCP credentials
*_secrets                      # Any secrets files (including production format)
*_secrets.local                # Local versions of secrets files
.gcp_parameters                # GCP VM parameters
production_dump_*.sql          # Database dumps
```

## How to Set Up Credentials Locally

### 1. Create `.env.local` from template

```bash
cp .env.local.example .env.local
```

### 2. Fill in your actual credentials

Edit `.env.local` with your real values:

```env
# Local PostgreSQL - using standard postgres variables
POSTGRES_USER=postgres
POSTGRES_PASSWORD=my_secure_password_here
POSTGRES_DB=csdm

# Backend configuration - must match above
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=my_secure_password_here
DB_DATABASE=csdm

# Production Database (readonly access for stats generation)
PROD_DB_HOST=your.production.host
PROD_DB_USER=readonly
PROD_DB_PASSWORD=your_readonly_password
PROD_DB_DATABASE=csdm
```

**Alternative**: You can also use `.pg_secrets.local` (matches production format):
```env
POSTGRES_PASSWORD=my_secure_password_here
```

### 3. Load environment variables before running scripts

**PowerShell:**
```powershell
Get-Content .env.local | ForEach-Object { 
    if($_ -match '^([^=]+)=(.*)$') { 
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
    }
}
```

**Bash/Linux:**
```bash
export $(cat .env.local | xargs)
```

### 4. Verify variables are loaded

```powershell
echo $env:POSTGRES_PASSWORD
```

## Using Credentials in Scripts

### Docker Compose
`docker-compose.local.yml` uses environment variables:

```yaml
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Please set POSTGRES_PASSWORD}
```

### Node.js Scripts
Always check for environment variables:

```javascript
if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD environment variable required');
}
```

### PowerShell Scripts
Use parameters with environment variable defaults:

```powershell
param(
    [string]$Password = $env:POSTGRES_PASSWORD
)

if (-not $Password) {
    Write-Error "Password required. Set POSTGRES_PASSWORD environment variable."
    exit 1
}
```

## What's Safe to Commit

✅ **Safe:**
- `.env.example` - Templates with placeholder values
- `.env.local.example` - Template for local setup
- `docker-compose.local.yml` - Uses environment variables
- Documentation with `your_password_here` placeholders

❌ **Never commit:**
- `.env` with actual values
- `.env.local` with actual values
- Any file with real passwords, tokens, or keys
- Database dumps containing real data
- `credentials.json` files

## Emergency: If You Accidentally Commit Secrets

1. **Immediately rotate all exposed credentials**
2. Remove from git history:
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch path/to/file" \
     --prune-empty --tag-name-filter cat -- --all
   ```
3. Force push (if safe to do so)
4. Change all passwords/tokens on production systems

## Production Secrets Management

Production secrets are managed via:
- **GitHub Secrets** for CI/CD workflows
- **Environment variables** set in Docker containers
- **GCP Secret Manager** for sensitive GCP operations

Never store production secrets in the repository.

## Questions?

If you're unsure whether something is safe to commit, **don't commit it**. Ask first.

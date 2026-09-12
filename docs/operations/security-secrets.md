# Security and Secrets

## Non-Negotiable Rules

- This repository is public. Never commit passwords, tokens, private keys, API credentials, or DB dumps.
- Keep sensitive values only in local ignored files.
- If a secret is exposed, rotate it immediately.

## Local Secret Files

Use templates and keep real values local:

- `.env.local.example` -> `.env.local`
- `backend/.env.example` -> `backend/.env`
- `frontend-nextjs/.env.example` -> `frontend-nextjs/.env.local`
- Optional: `.pg_secrets.local`

## Safe vs Unsafe

Safe to commit:

- `*.example` templates with placeholder values
- Documentation with non-real sample values
- Compose files that reference env vars

Never commit:

- Real `.env` or `.env.local` values
- Credential JSON files
- Database dumps from production
- Any token-bearing config

## Session Authentication

User sessions use HMAC-SHA256 tokens signed with `MATCHMAKING_TOKEN` (or `AUTH_TOKEN` fallback). The implementation is in `frontend-nextjs/src/lib/authSession.ts`. Tokens are stored as `csbatagi_session` cookies with a 30-day expiry, renewed during active browsing at most every 30 minutes. Renewal requires a still-valid Steam session, current roster membership and the stored SteamID/UID pair; idle polling does not extend login. Steam OpenID supplies identity, and only the player roster's SteamIDs can sign in. Edge middleware and Node API routes validate the signature, Steam identity and expiry. See [Steam login](../features/steam-login.md) for renewal, account/admin migration and current public-read boundaries.

If `MATCHMAKING_TOKEN` is rotated, all existing user sessions will be invalidated (users must re-login).

## Required GitHub Actions Secrets

| Secret | Used By | Purpose |
|--------|---------|---------|
| `VAPID_PUBLIC_KEY` | Frontend + Backend | Web Push VAPID public key (for push subscriptions) |
| `VAPID_PRIVATE_KEY` | Backend | Web Push VAPID private key (for sending push notifications) |
| `AUTH_TOKEN` | Frontend + Backend | Shared API auth token (also used as `MATCHMAKING_TOKEN` for session signing) |
| `SERVERACPASS` | Frontend | CS2 server admin password |
| `STEAM_API_KEY` | Frontend | Steam Web API key (for avatars/profiles) |
| `DB_PASSWORD` | Backend | PostgreSQL database password |
| `DB_USER` | Backend | PostgreSQL database user |
| `RCON_PASSWORD` | Backend | CS2 RCON password |
| `POSTGRES_PASSWORD` | PostgreSQL | Database superuser password |
| `POSTGRES_READONLY_PASSWORD` | PostgreSQL | Read-only user password |
| `GOOGLE_CREDENTIALS` | CI/CD | GCP service account JSON (for VM SSH/SCP) |
| `CLOUDFLARE_API_TOKEN` | DDNS | Cloudflare DNS update token |
| `GCP_VM_NAME` | CI/CD | Target VM name |
| `GCP_ZONE` | CI/CD | GCP zone |

Generate VAPID keys with: `npx web-push generate-vapid-keys`

## Emergency Response

1. Revoke and rotate exposed credentials.
2. Remove leaked files from git history.
3. Re-deploy systems using rotated secrets.
4. Notify maintainers if production credentials were affected.

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

## Emergency Response

1. Revoke and rotate exposed credentials.
2. Remove leaked files from git history.
3. Re-deploy systems using rotated secrets.
4. Notify maintainers if production credentials were affected.

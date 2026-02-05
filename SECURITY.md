# Security Guidelines

Use the canonical security doc:

- [`docs/operations/security-secrets.md`](docs/operations/security-secrets.md)

Minimum rules:

- Never commit credentials, tokens, keys, or DB dumps.
- Keep real values only in local ignored files (`.env.local`, `backend/.env`, etc.).
- Rotate credentials immediately if exposed.

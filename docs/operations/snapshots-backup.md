# Snapshots and Backups to Google Cloud Storage

Automated daily snapshots and on-demand disaster recovery backups for csbatagi production state.

## Overview

Snapshots capture the state of the persistent services on the host and ship them to Google Cloud Storage under `gs://csbatagi-demos/snapshots/YYYY-MM-DD/`.

The snapshot includes:
- **PostgreSQL (`csdm` DB)**: Logical snapshot using PostgreSQL custom format (`pg_dump -Fc`), compressed and non-locking.
- **Next.js Runtime Statistics**: The `csbatagi_nextjs_data` named Docker volume (runtime statistics, player caches, historical summaries).
- **TeamSpeak 6 Server State**: SQLite database (`tsserver.sqlitedb`, `-wal`, `-shm`), channel storage, and internal icons (excluding private SSH host keys).
- **CS2 Match Control**: `/srv/csbatagi/cs2-control` match state JSON files.
- **Configuration Templates**: `docker-compose.yml` and `Caddyfile`.
- **Integrity Files**: `manifest.json` and `sha256sums.txt`.

### Strict Secret Exclusion

> [!IMPORTANT]
> Snapshot archives **strictly exclude all private secret files**, tokens, and certificates:
> - Never included: `.backend_secrets`, `.frontend_secrets`, `.pg_secrets`, `.dns_secrets`, `.teamspeak6_server_secrets`, `.my_sql_secrets`, `credentials.json`, `caddy_data/` (SSL private keys), or SSH host keys (`*.key`).

---

## Architecture & Storage Target

- **Bucket**: `gs://csbatagi-demos` (region: `europe-west3`)
- **Prefix**: `snapshots/YYYY-MM-DD/`
- **GCP Service Account**: `backend-ci@esoteric-dryad-256520.iam.gserviceaccount.com` (mounted locally from `/srv/csbatagi/credentials.json`)
- **IAM Permission**: `roles/storage.objectUser` restricted to `resource.name.startsWith("projects/_/buckets/csbatagi-demos/objects/snapshots/")`.
- **Retention**: Rolling 30 days. Snapshots older than 30 days are automatically pruned at the end of each run.

---

## Automation & CI/CD Deployment

The snapshot infrastructure is deployed and maintained via CI:

1. **Deployment (`.github/workflows/deploy.yml`)**:
   - Synchronizes `ops/backup/backup-to-gcs.sh` to `/srv/csbatagi/ops/backup/backup-to-gcs.sh`.
   - Deploys `ops/backup/csbatagi-backup.service` and `ops/backup/csbatagi-backup.timer` to `/etc/systemd/system/`.
   - Enables and starts `csbatagi-backup.timer`.
2. **Scheduled Execution**:
   - `csbatagi-backup.timer` triggers daily at `03:30:00 UTC` with a 15-minute randomized delay to avoid thundering load.
   - Logs are captured in `journalctl -u csbatagi-backup.service`.
3. **On-Demand Execution (`.github/workflows/snapshot-backup.yml`)**:
   - Can be triggered manually at any time via GitHub Actions `workflow_dispatch` (e.g. before schema migrations or major updates).

---

## Disaster Recovery & Restoration Runbook

### 1. Download Snapshot from GCS

```bash
# Set snapshot date to restore
export SNAPSHOT_DATE="2026-10-22"
export RESTORE_DIR="/tmp/csbatagi-restore-${SNAPSHOT_DATE}"
mkdir -p "$RESTORE_DIR"

# Download snapshot files using credentials.json
CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="/srv/csbatagi/credentials.json" \
  gcloud storage cp "gs://csbatagi-demos/snapshots/${SNAPSHOT_DATE}/*" "$RESTORE_DIR/"

# Verify file integrity
cd "$RESTORE_DIR" && sha256sum -c sha256sums.txt
```

### 2. Restore PostgreSQL Database

```bash
# Copy dump into postgres container and restore
docker cp "$RESTORE_DIR"/postgres_csdm_*.dump csbatagi-postgres-1:/tmp/restore.dump

# Clean and restore database
docker exec -i csbatagi-postgres-1 pg_restore -U postgres --clean --if-exists -d csdm /tmp/restore.dump

# Remove temporary dump from container
docker exec csbatagi-postgres-1 rm -f /tmp/restore.dump
```

### 3. Restore Next.js Runtime Data

```bash
# Unpack data directly into the named docker volume
docker run --rm -v csbatagi_nextjs_data:/data -v "$RESTORE_DIR":/backup:ro alpine:latest \
  sh -c "tar -xzf /backup/nextjs_data_*.tar.gz -C /data"

# Restart frontend to reload data cache
docker compose -f /srv/csbatagi/docker-compose.yml restart frontend-nextjs
```

### 4. Restore TeamSpeak 6 State

```bash
# Stop teamspeak container
docker compose -f /srv/csbatagi/docker-compose.yml stop teamspeak

# Unpack data into /srv/csbatagi/teamspeak6/data
docker run --rm -v /srv/csbatagi/teamspeak6/data:/data -v "$RESTORE_DIR":/backup:ro alpine:latest \
  sh -c "tar -xzf /backup/teamspeak6_data_*.tar.gz -C /data"

# Restart teamspeak
docker compose -f /srv/csbatagi/docker-compose.yml start teamspeak
```

### 5. Verify Health

Check diagnostics endpoint and logs:
```bash
docker compose -f /srv/csbatagi/docker-compose.yml exec backend node -e '
  fetch("http://127.0.0.1:3000/stats/diagnostics")
    .then(r => r.json())
    .then(console.log);
'
```

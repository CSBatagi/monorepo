#!/usr/bin/env bash
# Regular snapshot backup script for csbatagi production deployment
# Backs up PostgreSQL DB, Next.js runtime data, TeamSpeak server state, CS2 match control,
# and compose configuration (EXCLUDING all private secrets) to Google Cloud Storage.
set -euo pipefail

# Configuration
BUCKET="${BUCKET:-csbatagi-demos}"
PREFIX="${PREFIX:-snapshots}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-/srv/csbatagi/credentials.json}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-csbatagi-postgres-1}"
POSTGRES_DB="${POSTGRES_DB:-csdm}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
NEXTJS_VOLUME="${NEXTJS_VOLUME:-csbatagi_nextjs_data}"
TEAMSPEAK_DIR="${TEAMSPEAK_DIR:-/srv/csbatagi/teamspeak6/data}"
CS2_CONTROL_DIR="${CS2_CONTROL_DIR:-/srv/csbatagi/cs2-control}"
COMPOSE_FILE="${COMPOSE_FILE:-/srv/csbatagi/docker-compose.yml}"
CADDYFILE="${CADDYFILE:-/srv/csbatagi/Caddyfile}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATE_TAG="$(date -u +%Y-%m-%d)"
STAGING_DIR="$(mktemp -d /tmp/csbatagi-snapshot-XXXXXX)"
GCLOUD_CFG="$(mktemp -d /tmp/gcloud-backup-XXXXXX)"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%d %H:%M:%SZ')" "$*"
}

cleanup() {
  local exit_code=$?
  if [ -d "$STAGING_DIR" ]; then
    rm -rf "$STAGING_DIR"
  fi
  if [ -d "$GCLOUD_CFG" ]; then
    rm -rf "$GCLOUD_CFG"
  fi
  if [ $exit_code -ne 0 ]; then
    log "Backup failed with exit code $exit_code"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

log "=== Starting csbatagi backup (${TIMESTAMP}) ==="

# Preflight checks
command -v docker >/dev/null 2>&1 || { log "ERROR: docker command not found"; exit 1; }
command -v gcloud >/dev/null 2>&1 || { log "ERROR: gcloud command not found"; exit 1; }

if [ ! -f "$CREDENTIALS_FILE" ]; then
  log "ERROR: Credentials file not found: $CREDENTIALS_FILE"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qw "$POSTGRES_CONTAINER"; then
  log "ERROR: Postgres container '$POSTGRES_CONTAINER' is not running"
  exit 1
fi

# Authenticate gcloud using service account in isolated config dir
export CLOUDSDK_CONFIG="$GCLOUD_CFG"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_CORE_DISABLE_USAGE_REPORTING=true

gcloud auth activate-service-account --key-file="$CREDENTIALS_FILE" --quiet >/dev/null 2>&1
log "Authenticated with GCP service account"

# 1. PostgreSQL custom-format compressed dump
PG_DUMP_FILE="$STAGING_DIR/postgres_${POSTGRES_DB}_${TIMESTAMP}.dump"
log "Dumping PostgreSQL database '${POSTGRES_DB}' from '${POSTGRES_CONTAINER}'..."
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > "$PG_DUMP_FILE"

PG_SIZE=$(stat -c%s "$PG_DUMP_FILE" 2>/dev/null || stat -f%z "$PG_DUMP_FILE")
if [ "$PG_SIZE" -lt 1000000 ]; then
  log "ERROR: PostgreSQL dump file suspiciously small (${PG_SIZE} bytes)"
  exit 1
fi
log "PostgreSQL dump complete (${PG_SIZE} bytes)"

# 2. Next.js runtime data volume dump
NEXTJS_DUMP_FILE="$STAGING_DIR/nextjs_data_${TIMESTAMP}.tar.gz"
if docker volume inspect "$NEXTJS_VOLUME" >/dev/null 2>&1; then
  log "Dumping Next.js runtime volume '${NEXTJS_VOLUME}'..."
  docker run --rm -v "${NEXTJS_VOLUME}:/data:ro" alpine:latest tar -czf - -C /data . > "$NEXTJS_DUMP_FILE"
  NEXTJS_SIZE=$(stat -c%s "$NEXTJS_DUMP_FILE" 2>/dev/null || stat -f%z "$NEXTJS_DUMP_FILE")
  log "Next.js volume dump complete (${NEXTJS_SIZE} bytes)"
else
  log "WARNING: Volume '${NEXTJS_VOLUME}' not found, skipping"
fi

# 3. TeamSpeak 6 server data
TS_DUMP_FILE="$STAGING_DIR/teamspeak6_data_${TIMESTAMP}.tar.gz"
if [ -d "$TEAMSPEAK_DIR" ]; then
  log "Archiving TeamSpeak data from '${TEAMSPEAK_DIR}'..."
  docker run --rm -v "${TEAMSPEAK_DIR}:/data:ro" alpine:latest \
    tar --exclude='*.key' --exclude='*ssh_host*' -czf - -C /data . > "$TS_DUMP_FILE"
  TS_SIZE=$(stat -c%s "$TS_DUMP_FILE" 2>/dev/null || stat -f%z "$TS_DUMP_FILE")
  log "TeamSpeak data archive complete (${TS_SIZE} bytes)"
else
  log "WARNING: TeamSpeak dir '${TEAMSPEAK_DIR}' not found, skipping"
fi

# 4. CS2 match control files
CS2_DUMP_FILE="$STAGING_DIR/cs2_control_${TIMESTAMP}.tar.gz"
if [ -d "$CS2_CONTROL_DIR" ]; then
  log "Archiving CS2 control data from '${CS2_CONTROL_DIR}'..."
  docker run --rm -v "${CS2_CONTROL_DIR}:/data:ro" alpine:latest \
    tar -czf - -C /data . > "$CS2_DUMP_FILE"
  CS2_SIZE=$(stat -c%s "$CS2_DUMP_FILE" 2>/dev/null || stat -f%z "$CS2_DUMP_FILE")
  log "CS2 control archive complete (${CS2_SIZE} bytes)"
fi

# 5. Non-sensitive configuration files (STRICTLY NO SECRETS)
CONFIGS_DUMP_FILE="$STAGING_DIR/configs_${TIMESTAMP}.tar.gz"
TMP_CFG_DIR="$STAGING_DIR/configs_tmp"
mkdir -p "$TMP_CFG_DIR"
if [ -f "$COMPOSE_FILE" ]; then
  cp "$COMPOSE_FILE" "$TMP_CFG_DIR/"
fi
if [ -f "$CADDYFILE" ]; then
  cp "$CADDYFILE" "$TMP_CFG_DIR/"
fi
tar -czf "$CONFIGS_DUMP_FILE" -C "$TMP_CFG_DIR" .
rm -rf "$TMP_CFG_DIR"
log "Configuration template archive complete (secrets excluded)"

# 6. Checksums and manifest
log "Generating checksums and manifest..."
(cd "$STAGING_DIR" && sha256sum * > sha256sums.txt)

cat <<EOF > "$STAGING_DIR/manifest.json"
{
  "timestamp": "${TIMESTAMP}",
  "date_tag": "${DATE_TAG}",
  "database": "${POSTGRES_DB}",
  "postgres_dump_size": ${PG_SIZE},
  "created_at_utc": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
}
EOF

# 7. Upload snapshot to Google Cloud Storage
DEST_GCS="gs://${BUCKET}/${PREFIX}/${DATE_TAG}/"
log "Uploading snapshot artifacts to ${DEST_GCS}..."
gcloud storage cp "$STAGING_DIR"/* "${DEST_GCS}" --quiet
log "Upload finished successfully"

# 8. Retention pruning of older snapshots
log "Checking retention (pruning snapshots older than ${RETENTION_DAYS} days)..."
CUTOFF_DATE="$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -u -v"-${RETENTION_DAYS}d" +%Y-%m-%d)"

# List all date folders under the snapshot prefix
EXISTING_PREFIXES="$(gcloud storage ls "gs://${BUCKET}/${PREFIX}/" 2>/dev/null | grep -E "gs://${BUCKET}/${PREFIX}/[0-9]{4}-[0-9]{2}-[0-9]{2}/" || true)"

if [ -n "$EXISTING_PREFIXES" ]; then
  while IFS= read -r snapshot_prefix; do
    [ -z "$snapshot_prefix" ] && continue
    # Extract YYYY-MM-DD from gs://bucket/snapshots/YYYY-MM-DD/
    folder_date="$(echo "$snapshot_prefix" | sed -nE 's/.*([0-9]{4}-[0-9]{2}-[0-9]{2})\/?$/\1/p')"
    if [ -n "$folder_date" ] && [ "$folder_date" \< "$CUTOFF_DATE" ]; then
      log "Pruning expired snapshot: ${snapshot_prefix} (older than ${CUTOFF_DATE})"
      gcloud storage rm -r "$snapshot_prefix" --quiet || log "WARNING: Failed to delete ${snapshot_prefix}"
    fi
  done <<< "$EXISTING_PREFIXES"
fi

log "=== csbatagi backup completed successfully ==="

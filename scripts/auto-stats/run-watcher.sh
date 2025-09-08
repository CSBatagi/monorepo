#!/usr/bin/env bash
set -euo pipefail

# Environment variables expected (injected via systemd EnvironmentFile):
# WATCH_PATH - directory to monitor for new demo files
# LOG_FILE - path to log file (append mode)
# DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD - Postgres connection
# CSDM_ANALYZE_EXTRA_ARGS - optional extra args for csdm analyze

echo "[watcher] Starting watcher script (PID $$)"

if [ -z "${WATCH_PATH:-}" ]; then
  echo "[watcher][error] WATCH_PATH not set" >&2
  exit 1
fi

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "[watcher][error] inotifywait not found" >&2
  exit 1
fi

if ! command -v csdm >/dev/null 2>&1; then
  echo "[watcher][warn] csdm CLI not found on PATH. Place a 'csdm' binary or adjust install instructions." >&2
fi

echo "[watcher] Monitoring path: $WATCH_PATH"

# Debounce window (seconds) to batch rapid file events
DEBOUNCE_SECONDS=5
last_run_ts=0

run_analyze() {
  now=$(date +%s)
  if (( now - last_run_ts < DEBOUNCE_SECONDS )); then
    echo "[watcher] Skipping analyze (debounce active)"
    return 0
  fi
  last_run_ts=$now
  echo "[watcher] Triggering analyze at $(date -Is)"

  # Build connection arguments for csdm if it supports them. Placeholder variables below;
  # Adjust according to actual CLI flags of csdm analyze (e.g., --db-host, --db-port, etc.).
  DB_ARGS=( )
  if command -v csdm >/dev/null 2>&1; then
    # Example flags (replace with real ones as necessary):
    DB_ARGS+=("--db-host" "$DB_HOST" "--db-port" "$DB_PORT" "--db-name" "$DB_NAME" "--db-user" "$DB_USER" "--db-password" "$DB_PASSWORD")
    # Execute analyze; output appended to log.
    set +e
    csdm analyze "$WATCH_PATH" "${DB_ARGS[@]}" ${CSDM_ANALYZE_EXTRA_ARGS:-}
    rc=$?
    set -e
    echo "[watcher] Analyze finished with exit code $rc"
  else
    echo "[watcher] (Simulated) would run: csdm analyze $WATCH_PATH ${CSDM_ANALYZE_EXTRA_ARGS:-}"
  fi
}

trap 'echo "[watcher] Caught SIGTERM, exiting"; exit 0' TERM INT

# Prime: run once on startup (optional). Comment out if not desired.
run_analyze

# Monitor for new or moved-in files.
inotifywait -m -e close_write,create,moved_to --format '%w%f' "$WATCH_PATH" | while read -r file; do
  # Basic filter: only react to regular files.
  if [ -f "$file" ]; then
    echo "[watcher] Detected file: $file"
    run_analyze
  fi
done

#!/usr/bin/env bash
set -euo pipefail

# Expects environment variables provided externally (.env sourced before execution):
# WATCH_PATH, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, CSDM_ANALYZE_EXTRA_ARGS, FORCE_REINSTALL

echo "[auto-stats] Starting remote installation at $(date)"

BASE_DIR="/opt/csdm-auto"
BIN_DIR="$BASE_DIR/bin"
LOG_DIR="/var/log/csdm-auto"
SERVICE_USER="steam"
ENV_FILE="/etc/csdm-auto-env"
SERVICE_FILE="/etc/systemd/system/csdm-auto-analyzer.service"

if [ "${FORCE_REINSTALL:-false}" = "true" ]; then
  echo "[auto-stats] Force reinstall requested; removing $BASE_DIR"
  sudo rm -rf "$BASE_DIR"
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "[auto-stats] Creating service user '$SERVICE_USER'"
  sudo useradd -m -r -s /usr/sbin/nologin "$SERVICE_USER" || true
fi

sudo mkdir -p "$BASE_DIR" "$BIN_DIR" "$LOG_DIR"
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$BASE_DIR" "$BIN_DIR" "$LOG_DIR"

# Dependencies
if ! command -v inotifywait >/dev/null 2>&1; then
  echo "[auto-stats] Installing inotify-tools"
  sudo apt-get update -y && sudo apt-get install -y inotify-tools
fi
if ! command -v unzip >/dev/null 2>&1; then
  sudo apt-get install -y unzip
fi

# Attempt headless csdm install (placeholder)
if ! command -v csdm >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    echo "[auto-stats] Installing @csdm/cli via npm (if package exists)"
    npm install -g @csdm/cli || echo "[auto-stats][warn] Could not install @csdm/cli; please manually install csdm binary."
  else
    echo "[auto-stats][warn] npm not found; skipping csdm installation"
  fi
fi

# Place watcher script
install -m 0755 /tmp/auto-stats/run-watcher.sh "$BIN_DIR/run-watcher.sh"
sudo chown "$SERVICE_USER":"$SERVICE_USER" "$BIN_DIR/run-watcher.sh"

cat > /tmp/csdm-auto-env <<ENV
WATCH_PATH="${WATCH_PATH}"
DB_HOST="${DB_HOST}"
DB_PORT="${DB_PORT}"
DB_NAME="${DB_NAME}"
DB_USER="${DB_USER}"
DB_PASSWORD="${DB_PASSWORD}"
CSDM_ANALYZE_EXTRA_ARGS="${CSDM_ANALYZE_EXTRA_ARGS}"
ENV
sudo mv /tmp/csdm-auto-env "$ENV_FILE"

cat > /tmp/csdm-auto-analyzer.service <<SERVICE
[Unit]
Description=CS Demo Manager Auto Analyzer
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
EnvironmentFile=/etc/csdm-auto-env
ExecStart=/opt/csdm-auto/bin/run-watcher.sh
Restart=always
RestartSec=5
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=/opt/csdm-auto
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=/opt/csdm-auto /home/steam/cs2/game/csgo/mounted_bucket

[Install]
WantedBy=multi-user.target
SERVICE
sudo mv /tmp/csdm-auto-analyzer.service "$SERVICE_FILE"

sudo systemctl daemon-reload
sudo systemctl enable --now csdm-auto-analyzer.service
sudo systemctl status csdm-auto-analyzer.service --no-pager || true

echo "[auto-stats] Installation complete"

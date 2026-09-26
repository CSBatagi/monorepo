#!/usr/bin/env bash
# Install the CS Demo Manager CLI and the CS Batagi analyzer service on the game VM. Run as root.
#
# Required environment: CSDM_DB_HOST, CSDM_DB_USER, CSDM_DB_PASSWORD (a role limited to the
# CS Demo Manager tables). Optional: CSDM_DB_PORT (5432), CSDM_DB_NAME (csdm), CSDM_VERSION.
# The version must match the desktop CS Demo Manager the club uses, because the CLI migrates
# the shared database schema on connect.
set -euo pipefail

VERSION="${CSDM_VERSION:-3.20.1}"
DEB="cs-demo-manager_${VERSION}_amd64.deb"
PACKAGES=/home/steam/resurrection-packages
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${CSDM_DB_HOST:?set CSDM_DB_HOST}"
: "${CSDM_DB_USER:?set CSDM_DB_USER}"
: "${CSDM_DB_PASSWORD:?set CSDM_DB_PASSWORD}"

mkdir -p "$PACKAGES"
cd "$PACKAGES"
if [ ! -f "$DEB" ]; then
  curl -fsSL -o "$DEB" "https://github.com/akiver/cs-demo-manager/releases/download/v${VERSION}/${DEB}"
fi
echo "Package checksum: $(sha256sum "$DEB")"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq "./$DEB"
# The package does not declare every shared library the Electron binary loads, even in Node mode.
apt-get install -y -qq libgbm1 libasound2 libnss3 libgtk-3-0 libxss1 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libcups2 libatspi2.0-0 libxfixes3

# The CLI needs a PostgreSQL 17 client; Ubuntu 22.04 ships 14.
if ! psql --version 2>/dev/null | grep -q ' 17\.'; then
  install -d /etc/apt/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-client-17
fi

ASAR="$(dpkg -L cs-demo-manager | grep '/resources/app.asar$' | head -1)"
APPDIR="$(dirname "$(dirname "$ASAR")")"
BIN="$(find "$APPDIR" -maxdepth 1 -type f -name 'cs-demo-manager' | head -1)"
[ -n "$ASAR" ] && [ -n "$BIN" ] || { echo "Cannot locate the CS Demo Manager binary" >&2; exit 1; }
cat > /usr/local/bin/csdm <<WRAPPER
#!/bin/sh
# CS Demo Manager CLI: the Electron binary in Node mode, no display required.
export ELECTRON_RUN_AS_NODE=1
exec "$BIN" "$ASAR/cli.js" "\$@"
WRAPPER
chmod 755 /usr/local/bin/csdm

# Database settings for the steam user only (mode 600). Never copy this file into the repository.
install -d -o steam -g steam -m 700 /home/steam/.config /home/steam/.config/csdm
python3 - <<'SETTINGS'
import json, os, pathlib
target = pathlib.Path('/home/steam/.config/csdm/settings.json')
settings = json.loads(target.read_text()) if target.exists() else {}
# Values pasted from Windows end in "\r", which the CLI then treats as part of the hostname.
env = lambda name, default=None: os.environ.get(name, default).strip()
settings['database'] = {
    'hostname': env('CSDM_DB_HOST'), 'port': int(env('CSDM_DB_PORT', '5432')),
    'username': env('CSDM_DB_USER'), 'password': os.environ['CSDM_DB_PASSWORD'].rstrip('\r\n'),
    'database': env('CSDM_DB_NAME', 'csdm'),
}
settings.setdefault('autoDownloadUpdates', False)
settings.setdefault('folders', [])
target.write_text(json.dumps(settings, indent=2))
SETTINGS
chown steam:steam /home/steam/.config/csdm/settings.json
chmod 600 /home/steam/.config/csdm/settings.json

install -d /usr/local/lib/csbatagi
install -m 755 "$HERE/demo-analyzer.py" /usr/local/lib/csbatagi/demo-analyzer.py
install -m 644 "$HERE/csbatagi-analyzer.service" /etc/systemd/system/csbatagi-analyzer.service
systemctl daemon-reload
systemctl enable csbatagi-analyzer.service

echo "CLI smoke test:"
sudo -u steam -H /usr/local/bin/csdm analyze 2>&1 | head -3 || true
echo "Start the worker with: systemctl start csbatagi-analyzer && journalctl -u csbatagi-analyzer -f"

#!/usr/bin/env bash
# Runs on the game VM. The demo-analysis setup workflow copies it to /tmp and calls it over SSH
# (see ci-demo-analysis-setup.sh); it can also be used by hand with the same subcommands.
#   installed      sha256 of the installed worker, then the service state
#   install FILE   install FILE as the analyzer worker (waits for a running analysis first)
#   state          analyzing | busy | idle | no-status (whether the VM can be stopped)
#   db show        the CLI's database settings (no password) and a login test with them
#   db schema      the CS Demo Manager schema version of that database, or "unknown"
#   db set HOST PORT USER DATABASE   rewrite them, password on stdin, then the same test
#   cli-version    the installed CS Demo Manager package version, or "none"
#   cli-install VERSION SHA256   install that CS Demo Manager .deb (checked against SHA256), waiting
#                  for a running analysis first; the worker is stopped meanwhile
set -euo pipefail

TARGET=/usr/local/lib/csbatagi/demo-analyzer.py
PACKAGES=/home/steam/resurrection-packages

# The CLI runs as the Electron binary with ".../cli.js analyze" on its command line; the bracket
# keeps pgrep from matching this script's own shell.
analysis_running() { pgrep -f '[c]li.js analyze' >/dev/null; }

# The CS Demo Manager CLI reads its database from the steam user's settings file (mode 600). The
# login test connects the way the CLI does, so a bad hostname, a closed port, a wrong password or a
# missing grant shows up here instead of as a failed analysis.
DB_SETTINGS_PY='
import json, os, pathlib, subprocess, sys
target = pathlib.Path.home() / ".config" / "csdm" / "settings.json"
settings = json.loads(target.read_text()) if target.exists() else {}
database = settings.get("database") or {}
if sys.argv[1] == "transport":
    # CS Demo Manager may rewrite its settings and discard extra metadata.
    private_loopback = database.get("hostname") == "127.0.0.1" and str(database.get("port")) == "15432"
    print("iap-reverse-ssh" if private_loopback else settings.get("csbatagiDatabaseTransport", "direct"))
    sys.exit(0)
if sys.argv[1] == "schema":
    try:
        result = subprocess.run(
            ["psql", "-X", "-h", str(database.get("hostname")), "-p", str(database.get("port") or 5432),
             "-U", str(database.get("username")), "-d", str(database.get("database")), "-Atc",
             "SELECT max(schema_version) FROM migrations"],
            env={**os.environ, "PGPASSWORD": str(database.get("password") or ""), "PGCONNECT_TIMEOUT": "10"},
            capture_output=True, text=True, timeout=30)
        version = result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        version = ""
    print(version if version.isdigit() else "unknown")
    sys.exit(0)
def shown(d):
    return ", ".join(f"{key}={d.get(key)!r}" for key in ("hostname", "port", "username", "database"))
if sys.argv[1] == "set":
    # Stray whitespace breaks everything silently: the 11 September install had "10.142.0.9\r" etc.
    host, port, user, name = (value.strip() for value in sys.argv[2:6])
    password = sys.stdin.read().rstrip("\r\n")
    if not password:
        sys.exit("db set: no password on stdin")
    wanted = {**database, "hostname": host, "port": int(port), "username": user, "password": password, "database": name}
    if wanted == database:
        print("Database settings already current:", shown(database))
    else:
        print("Database settings were:", shown(database), "(password", "unchanged)" if database.get("password") == password else "changed)")
        settings["database"] = database = wanted
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".part")
        with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as out:
            json.dump(settings, out, indent=2)
        os.replace(partial, target)
        print("Database settings now:", shown(database))
else:
    print("Database settings:", shown(database))
result = subprocess.run(
    ["psql", "-X", "-h", str(database.get("hostname")), "-p", str(database.get("port") or 5432), "-U", str(database.get("username")),
     "-d", str(database.get("database")), "-Atc", "SELECT max(schema_version) FROM migrations"],
    env={**os.environ, "PGPASSWORD": str(database.get("password") or ""), "PGCONNECT_TIMEOUT": "10"}, capture_output=True, text=True)
if result.returncode != 0:
    sys.exit("Database login FAILED: " + result.stderr.strip())
print("Database login OK as", database.get("username") + "; CS Demo Manager schema version", result.stdout.strip())
'

case "${1:-}" in
  installed)
    sha256sum "$TARGET" | cut -d' ' -f1
    systemctl is-active csbatagi-analyzer || true
    ;;
  install)
    python3 -m py_compile "$2"
    # Never cut an analysis short: give a running one up to 15 minutes to finish.
    for _ in $(seq 1 90); do analysis_running || break; sleep 10; done
    sudo install -m 755 -o root -g root "$2" "$TARGET"
    sudo systemctl restart csbatagi-analyzer
    sleep 3
    systemctl is-active csbatagi-analyzer
    ;;
  db)
    case "${2:-}" in show|set|transport|schema) ;; *) echo "usage: $0 db show | db schema | db transport | db set HOST PORT USER DATABASE" >&2; exit 2 ;; esac
    sudo -u steam -H python3 -c "$DB_SETTINGS_PY" "${@:2}"
    ;;
  cli-version)
    dpkg-query -W -f='${Version}\n' cs-demo-manager 2>/dev/null || echo none
    ;;
  cli-install)
    version="${2:?usage: $0 cli-install VERSION SHA256}"
    sha256="${3:?usage: $0 cli-install VERSION SHA256}"
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "cli-install: bad version or sha256" >&2; exit 2; }
    deb="$PACKAGES/cs-demo-manager_${version}_amd64.deb"
    sudo install -d -o steam -g steam "$PACKAGES"
    if [ ! -f "$deb" ] || [ "$(sha256sum "$deb" | cut -d' ' -f1)" != "$sha256" ]; then
      sudo rm -f "$deb" "$deb.part"
      sudo -u steam curl -fsSL --retry 3 -o "$deb.part" \
        "https://github.com/akiver/cs-demo-manager/releases/download/v${version}/cs-demo-manager_${version}_amd64.deb"
      got="$(sha256sum "$deb.part" | cut -d' ' -f1)"
      if [ "$got" != "$sha256" ]; then
        sudo rm -f "$deb.part"
        echo "cli-install: sha256 mismatch for $version (got $got)" >&2
        exit 1
      fi
      sudo mv "$deb.part" "$deb"
    fi
    # Never cut an analysis short, and keep the worker from starting one mid-upgrade.
    for _ in $(seq 1 90); do analysis_running || break; sleep 10; done
    if analysis_running; then echo "cli-install: an analysis is still running after 15 minutes" >&2; exit 1; fi
    sudo systemctl stop csbatagi-analyzer
    trap 'sudo systemctl start csbatagi-analyzer' EXIT
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o DPkg::Lock::Timeout=300 "$deb"
    # The wrapper runs the Electron binary in Node mode (install-analyzer.sh); refresh its paths in case
    # the package moved them.
    asar="$(dpkg -L cs-demo-manager | grep '/resources/app.asar$' | head -1)"
    appdir="$(dirname "$(dirname "$asar")")"
    bin="$(find "$appdir" -maxdepth 1 -type f -name 'cs-demo-manager' | head -1)"
    [ -n "$asar" ] && [ -n "$bin" ] || { echo "cli-install: cannot locate the CS Demo Manager binary" >&2; exit 1; }
    printf '#!/bin/sh\n# CS Demo Manager CLI: the Electron binary in Node mode, no display required.\nexport ELECTRON_RUN_AS_NODE=1\nexec "%s" "%s/cli.js" "$@"\n' "$bin" "$asar" \
      | sudo tee /usr/local/bin/csdm >/dev/null
    sudo chmod 755 /usr/local/bin/csdm
    installed="$(dpkg-query -W -f='${Version}' cs-demo-manager)"
    [ "$installed" = "$version" ] || { echo "cli-install: package reports $installed, expected $version" >&2; exit 1; }
    # Usage text proves the CLI starts headless; it exits non-zero without arguments.
    sudo -u steam -H /usr/local/bin/csdm analyze 2>&1 | head -3 || true
    echo "CS Demo Manager CLI $installed installed."
    ;;
  state)
    if analysis_running; then echo analyzing; exit 0; fi
    STATUS="$(sudo python3 /usr/local/lib/csbatagi/rcon-local.py csbatagi_status 2>/dev/null || true)" python3 - <<'PY'
import json
import os

text = os.environ.get('STATUS', '')
try:
    status = json.loads(text[text.index('{'):text.rindex('}') + 1])
except ValueError:
    print('no-status')  # CS2 is not answering (still booting or stopped)
    raise SystemExit
busy = status.get('live') or status.get('preparing') or status.get('recording') or int(status.get('humans') or 0) > 0
print('busy' if busy else 'idle')
PY
    ;;
  *)
    echo "usage: $0 installed | install FILE | state | db show | db schema | db set HOST PORT USER DATABASE | cli-version | cli-install VERSION SHA256" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# Runs on the game VM. The demo-analysis setup workflow copies it to /tmp and calls it over SSH
# (see ci-demo-analysis-setup.sh); it can also be used by hand with the same subcommands.
#   installed      sha256 of the installed worker, then the service state
#   install FILE   install FILE as the analyzer worker (waits for a running analysis first)
#   state          analyzing | busy | idle | no-status (whether the VM can be stopped)
#   db show        the CLI's database settings (no password) and a login test with them
#   db set HOST PORT USER DATABASE   rewrite them, password on stdin, then the same test
set -euo pipefail

TARGET=/usr/local/lib/csbatagi/demo-analyzer.py

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
def shown(d):
    return ", ".join(f"{key}={d.get(key)!r}" for key in ("hostname", "port", "username", "database"))
if sys.argv[1] == "set":
    host, port, user, name = sys.argv[2:6]
    password = sys.stdin.read().rstrip("\n")
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
    [ "${2:-}" = show ] || [ "${2:-}" = set ] || { echo "usage: $0 db show | db set HOST PORT USER DATABASE" >&2; exit 2; }
    sudo -u steam -H python3 -c "$DB_SETTINGS_PY" "${@:2}"
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
    echo "usage: $0 installed | install FILE | state | db show | db set HOST PORT USER DATABASE" >&2
    exit 2
    ;;
esac

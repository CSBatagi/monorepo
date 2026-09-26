#!/usr/bin/env bash
# Runs on the game VM. The demo-analysis setup workflow copies it to /tmp and calls it over SSH
# (see ci-demo-analysis-setup.sh); it can also be used by hand with the same subcommands.
#   installed      sha256 of the installed worker, then the service state
#   install FILE   install FILE as the analyzer worker (waits for a running analysis first)
#   state          analyzing | busy | idle | no-status (whether the VM can be stopped)
set -euo pipefail

TARGET=/usr/local/lib/csbatagi/demo-analyzer.py

# The CLI runs as the Electron binary with ".../cli.js analyze" on its command line; the bracket
# keeps pgrep from matching this script's own shell.
analysis_running() { pgrep -f '[c]li.js analyze' >/dev/null; }

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
    echo "usage: $0 installed | install FILE | state" >&2
    exit 2
    ;;
esac

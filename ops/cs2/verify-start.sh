#!/usr/bin/env bash
set -euo pipefail
if runuser -u steam -- /usr/bin/python3 /usr/local/lib/csbatagi/update-stack.py verify; then
  /usr/local/lib/csbatagi/gate.sh open
else
  exit 1
fi

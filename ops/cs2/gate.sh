#!/usr/bin/env bash
# Root-only UDP and password gates. Keep private TCP RCON for verification.
set -euo pipefail
RULE=(-p udp --dport 27015 -m comment --comment csbatagi-startup -j DROP)
case "${1:-}" in
  close)
    iptables -C INPUT "${RULE[@]}" 2>/dev/null || iptables -I INPUT 1 "${RULE[@]}"
    python3 /usr/local/lib/csbatagi/connection-gate.py close
    ;;
  open)
    python3 /usr/local/lib/csbatagi/connection-gate.py open
    while iptables -C INPUT "${RULE[@]}" 2>/dev/null; do iptables -D INPUT "${RULE[@]}"; done
    ;;
  *) exit 2 ;;
esac

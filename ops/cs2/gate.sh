#!/usr/bin/env bash
# Root-only public UDP gate. Keep private TCP RCON available for verification.
set -euo pipefail
RULE=(-p udp --dport 27015 -m comment --comment csbatagi-startup -j DROP)
case "${1:-}" in
  close) iptables -C INPUT "${RULE[@]}" 2>/dev/null || iptables -I INPUT 1 "${RULE[@]}" ;;
  open) while iptables -C INPUT "${RULE[@]}" 2>/dev/null; do iptables -D INPUT "${RULE[@]}"; done ;;
  *) exit 2 ;;
esac
